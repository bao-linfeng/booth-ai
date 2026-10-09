import type pg from 'pg';
import { findSchemesByCodes, type SchemeRecord } from '../service.js';
import { importRowChanges, onlyNotesChanged } from './changes.js';
import type { ImportPreviewRow, ImportRow, ImportRowSource, ImportSummary, ParsedImportRow, PreviewImportResult } from './types.js';
import { importDictionaryLabels, loadImportDictionaries, missingRequiredField, validateImportRow, type ImportDictionaries } from './validation.js';
import { parseWorkbook } from './workbook.js';

async function findExistingSchemes(pool: pg.Pool, parsedRows: ParsedImportRow[]): Promise<Map<string, SchemeRecord>> {
  const codes = [...new Set(parsedRows.map(row => row.data.code).filter(code => code !== ''))];
  return new Map((await findSchemesByCodes(pool, codes)).map(scheme => [scheme.code, scheme]));
}

/**
 * 已存在的编号与当前方案比较：无差异为 unchanged（提交时不写入），否则为 duplicate 并记录变化、将清空的字段；
 * 同时记录当前版本，提交时据此做乐观并发校验。
 */
function existingRow(row: ImportPreviewRow & { data: ImportRow }, current: SchemeRecord, summary: ImportSummary): ImportPreviewRow {
  const { changedFields, clearedFields } = importRowChanges(current, row.data);
  const published = current.publishStatus === 'published';
  if (changedFields.length === 0) {
    summary.unchanged += 1;
    return { ...row, status: 'unchanged', snapshotRevision: current.editRevision, published, changedFields, clearedFields };
  }
  summary.duplicate += 1;
  if (published && !onlyNotesChanged(changedFields)) summary.unpublish += 1;
  return { ...row, status: 'duplicate', snapshotRevision: current.editRevision, published, changedFields, clearedFields };
}

/**
 * 逐行分类为 valid / duplicate / unchanged / error；空行计入 skipped。
 * rowId 按解析顺序从 1 编号，跨工作表唯一；行号保留各工作表内的原始行号。
 */
function classifyRows(dictionaries: ImportDictionaries, parsedRows: ParsedImportRow[], existing: Map<string, SchemeRecord>): { rows: ImportPreviewRow[]; summary: ImportSummary } {
  const summary: ImportSummary = { total: parsedRows.length, valid: 0, duplicate: 0, unchanged: 0, error: 0, skipped: 0, unpublish: 0 };
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
      data = validateImportRow(dictionaries, parsed);
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
    const row = { ...source, code, name, status: 'valid' as const, data, dictionaryLabels: importDictionaryLabels(dictionaries, data) };
    const current = existing.get(code);
    if (current) {
      rows.push(existingRow(row, current, summary));
    } else {
      summary.valid += 1;
      rows.push(row);
    }
  }
  return { rows, summary };
}

async function savePreview(pool: pg.Pool, adminId: string | null, filename: string, rows: ImportPreviewRow[], summary: ImportSummary): Promise<{ importId: string; expiresAt: string }> {
  const inserted = await pool.query<{ id: string; expiresAt: Date }>(`
    INSERT INTO scheme_imports (source_filename, preview, summary, expires_at, created_by)
    VALUES ($1, $2, $3, now() + interval '1 hour', $4)
    RETURNING id::text AS id, expires_at AS "expiresAt"
  `, [filename, JSON.stringify(rows), JSON.stringify(summary), adminId]);
  const saved = inserted.rows[0];
  if (!saved) throw Object.assign(new Error('Failed to create import preview'), { statusCode: 500 });
  return { importId: saved.id, expiresAt: new Date(saved.expiresAt).toISOString() };
}

export async function previewImport(pool: pg.Pool, adminId: string | null, buffer: Buffer, filename: string): Promise<PreviewImportResult> {
  const parsedRows = await parseWorkbook(buffer);
  const existing = await findExistingSchemes(pool, parsedRows);
  const dictionaries = await loadImportDictionaries(pool);
  const { rows, summary } = classifyRows(dictionaries, parsedRows, existing);
  const { importId, expiresAt } = await savePreview(pool, adminId, filename, rows, summary);
  return { importId, expiresAt, rows, summary };
}
