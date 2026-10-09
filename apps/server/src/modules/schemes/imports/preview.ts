import type pg from 'pg';
import type { ImportPreviewRow, ImportRow, ImportRowSource, ImportSummary, ParsedImportRow, PreviewImportResult } from './types.js';
import { missingRequiredField, validateImportRow } from './validation.js';
import { parseWorkbook } from './workbook.js';

async function findExistingCodes(pool: pg.Pool, parsedRows: ParsedImportRow[]): Promise<Set<string>> {
  const codes = [...new Set(parsedRows.map(row => row.data.code).filter(code => code !== ''))];
  if (codes.length === 0) return new Set();
  const existing = await pool.query<{ code: string }>('SELECT code FROM schemes WHERE code = ANY($1::text[])', [codes]);
  return new Set(existing.rows.map(row => row.code));
}

/**
 * 逐行分类为 valid / duplicate / error；空行计入 skipped。
 * rowId 按解析顺序从 1 编号，跨工作表唯一；行号保留各工作表内的原始行号。
 */
async function classifyRows(pool: pg.Pool, parsedRows: ParsedImportRow[], existingCodes: Set<string>): Promise<{ rows: ImportPreviewRow[]; summary: ImportSummary }> {
  const summary: ImportSummary = { total: parsedRows.length, valid: 0, duplicate: 0, error: 0, skipped: 0 };
  const rows: ImportPreviewRow[] = [];
  const firstSeen = new Map<string, ImportRowSource>();
  for (const [index, { sheetName, rowNumber, data: parsed }] of parsedRows.entries()) {
    const source = { rowId: index + 1, sheetName, rowNumber };
    const { code, name } = parsed;
    if (code === '' && name === '') {
      summary.skipped += 1;
      continue;
    }
    const missing = missingRequiredField(parsed);
    if (missing) {
      summary.error += 1;
      rows.push({ ...source, code, name, status: 'error', reason: missing });
      continue;
    }
    let data: ImportRow;
    try {
      data = await validateImportRow(pool, parsed);
    } catch (error) {
      summary.error += 1;
      rows.push({ ...source, code, name, status: 'error', reason: error instanceof Error ? error.message : '导入数据无效' });
      continue;
    }
    const first = firstSeen.get(code);
    if (first) {
      summary.error += 1;
      rows.push({ ...source, code, name, status: 'error', reason: `文件内方案编号重复（首次出现于「${first.sheetName}」第 ${first.rowNumber} 行）` });
      continue;
    }
    firstSeen.set(code, { sheetName, rowNumber });
    if (existingCodes.has(code)) {
      summary.duplicate += 1;
      rows.push({ ...source, code, name, status: 'duplicate', data });
    } else {
      summary.valid += 1;
      rows.push({ ...source, code, name, status: 'valid', data });
    }
  }
  return { rows, summary };
}

/** 为重复行记录当前方案版本，提交时据此做乐观并发校验。 */
async function snapshotDuplicateRevisions(pool: pg.Pool, rows: ImportPreviewRow[]): Promise<void> {
  const duplicateCodes = rows.filter(row => row.status === 'duplicate').map(row => row.code);
  if (duplicateCodes.length === 0) return;
  const revisions = await pool.query<{ code: string; revision: number }>(
    'SELECT code, revision FROM schemes WHERE code = ANY($1::text[])', [duplicateCodes],
  );
  const revisionsByCode = new Map(revisions.rows.map(row => [row.code, row.revision]));
  for (const row of rows) {
    if (row.status === 'duplicate') row.snapshotRevision = revisionsByCode.get(row.code);
  }
}

async function savePreview(pool: pg.Pool, adminId: string | null, filename: string, rows: ImportPreviewRow[], summary: ImportSummary): Promise<string> {
  const inserted = await pool.query<{ id: string }>(`
    INSERT INTO scheme_imports (source_filename, preview, summary, expires_at, created_by)
    VALUES ($1, $2, $3, now() + interval '1 hour', $4)
    RETURNING id::text AS id
  `, [filename, JSON.stringify(rows), JSON.stringify(summary), adminId]);
  const importId = inserted.rows[0]?.id;
  if (!importId) throw Object.assign(new Error('Failed to create import preview'), { statusCode: 500 });
  return importId;
}

export async function previewImport(pool: pg.Pool, adminId: string | null, buffer: Buffer, filename: string): Promise<PreviewImportResult> {
  const parsedRows = await parseWorkbook(buffer);
  const existingCodes = await findExistingCodes(pool, parsedRows);
  const { rows, summary } = await classifyRows(pool, parsedRows, existingCodes);
  await snapshotDuplicateRevisions(pool, rows);
  const importId = await savePreview(pool, adminId, filename, rows, summary);
  return { importId, rows, summary };
}
