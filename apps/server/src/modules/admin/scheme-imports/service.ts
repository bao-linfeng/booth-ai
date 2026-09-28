import ExcelJS from 'exceljs';
import type pg from 'pg';
import { transaction } from '../../../infra/database.js';

export interface ImportRow {
  code: string;
  name: string;
  parentCode: string | null;
  widthCm: number | null;
  lengthCm: number | null;
  areaSqm: number | null;
  heightCm: number | null;
  openingCount: number | null;
  productLine: string | null;
  style: string | null;
  industries: string[] | null;
  budgetTier: string | null;
  functionalZones: string[] | null;
  keyFeatures: string[] | null;
  description: string | null;
  keywords: string[] | null;
  verificationStatus: 'unverified' | 'verified' | 'failed';
  notes: string | null;
}

export interface ImportSummary {
  total: number;
  valid: number;
  duplicate: number;
  error: number;
  skipped: number;
}

export interface ImportPreviewRow {
  rowNumber: number;
  code: string;
  name: string;
  status: 'valid' | 'duplicate' | 'error';
  reason?: string;
  data?: ImportRow;
}

export interface PreviewImportResult {
  importId: string;
  rows: ImportPreviewRow[];
  summary: ImportSummary;
}

export interface CommitImportOptions {
  duplicateStrategy: 'skip' | 'update';
  selectedRows?: number[];
}

export interface CommitImportResult {
  created: number;
  updated: number;
  failed: { rowNumber: number; code: string; reason: string }[];
}

interface XlsxLoader {
  load(buffer: Buffer): Promise<ExcelJS.Workbook>;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map(part => part.text).join('').trim();
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
  }
  return String(value).trim();
}

function optionalText(value: ExcelJS.CellValue): string | null {
  const text = cellText(value);
  return text === '' ? null : text;
}

function numericValue(value: ExcelJS.CellValue, multiplier = 1): number | null {
  const text = cellText(value);
  if (text === '') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number * multiplier : null;
}

function listValue(value: ExcelJS.CellValue): string[] | null {
  const text = cellText(value);
  if (text === '') return null;
  return text.split(/[,，]/).map(item => item.trim()).filter(item => item !== '');
}

function openingCount(value: ExcelJS.CellValue): number | null {
  const text = cellText(value);
  if (text === '') return null;
  if (text === '岛式') return 4;
  // 支持 "3面"、"2面" 等格式
  const faceMatch = text.match(/^(\d+)\s*面$/);
  if (faceMatch) return Number(faceMatch[1]);
  const number = Number(text);
  return Number.isInteger(number) ? number : null;
}

function verificationStatus(value: ExcelJS.CellValue): ImportRow['verificationStatus'] {
  const text = cellText(value);
  if (text === '已核验') return 'verified';
  if (text === '核验失败') return 'failed';
  return 'unverified';
}

function parseRow(row: ExcelJS.Row): ImportRow {
  return {
    code: cellText(row.getCell(2).value),
    name: cellText(row.getCell(3).value),
    parentCode: optionalText(row.getCell(4).value),
    widthCm: numericValue(row.getCell(6).value, 100),
    lengthCm: numericValue(row.getCell(7).value, 100),
    areaSqm: numericValue(row.getCell(8).value),
    heightCm: numericValue(row.getCell(9).value, 100),
    openingCount: openingCount(row.getCell(10).value),
    productLine: optionalText(row.getCell(11).value),
    style: optionalText(row.getCell(12).value),
    industries: listValue(row.getCell(13).value),
    budgetTier: optionalText(row.getCell(14).value),
    functionalZones: listValue(row.getCell(15).value),
    keyFeatures: listValue(row.getCell(16).value),
    description: optionalText(row.getCell(17).value),
    keywords: listValue(row.getCell(18).value),
    verificationStatus: verificationStatus(row.getCell(19).value),
    notes: optionalText(row.getCell(20).value),
  };
}

function parseError(): Error & { statusCode: number } {
  return Object.assign(new Error('Failed to parse Excel file'), { statusCode: 400 });
}

const insertSql = `
  INSERT INTO schemes (
    code, name, parent_code, width_cm, length_cm, area_sqm, height_cm,
    opening_count, product_line, style, industries, budget_tier,
    functional_zones, key_features, description, keywords,
    notes, created_by, updated_by
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19
  )
`;

const updateSql = `
  UPDATE schemes SET
    name = $2,
    parent_code = $3,
    width_cm = $4,
    length_cm = $5,
    area_sqm = $6,
    height_cm = $7,
    opening_count = $8,
    product_line = $9,
    style = $10,
    industries = $11,
    budget_tier = $12,
    functional_zones = $13,
    key_features = $14,
    description = $15,
    keywords = $16,
    notes = $17,
    updated_by = $18,
    updated_at = now(),
    revision = revision + 1,
    verification_status = 'unverified',
    publish_status = CASE WHEN publish_status = 'published' THEN 'draft' ELSE publish_status END
  WHERE code = $1
  RETURNING id
`;

async function parseWorkbook(buffer: Buffer): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await (workbook.xlsx as unknown as XlsxLoader).load(buffer);
  } catch {
    throw parseError();
  }

  const rows: ImportRow[] = [];
  for (const worksheet of workbook.worksheets) {
    if (worksheet.name.includes('说明') || worksheet.name.includes('选项')) continue;
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      rows.push(parseRow(worksheet.getRow(rowNumber)));
    }
  }
  return rows;
}

function importRowFromJson(value: unknown): ImportPreviewRow | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<ImportPreviewRow>;
  if (typeof row.rowNumber !== 'number' || typeof row.code !== 'string' || typeof row.name !== 'string' ||
    (row.status !== 'valid' && row.status !== 'duplicate' && row.status !== 'error')) return null;
  return row as ImportPreviewRow;
}

function mapDbError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes('parent_code') || msg.includes('foreign key')) return '母方案不存在';
    if (msg.includes('schemes_code_key') || msg.includes('unique')) return '方案编号已存在';
  }
  return '数据库写入失败';
}

export async function previewImport(pool: pg.Pool, adminId: string | null, buffer: Buffer, filename: string): Promise<PreviewImportResult> {
  const parsedRows = await parseWorkbook(buffer);
  const codes = [...new Set(parsedRows.map(row => row.code).filter(code => code !== ''))];
  const existingCodes = new Set<string>();
  if (codes.length > 0) {
    const existing = await pool.query<{ code: string }>('SELECT code FROM schemes WHERE code = ANY($1::text[])', [codes]);
    for (const row of existing.rows) existingCodes.add(row.code);
  }

  const summary: ImportSummary = { total: parsedRows.length, valid: 0, duplicate: 0, error: 0, skipped: 0 };
  const rows: ImportPreviewRow[] = [];
  const seenCodes = new Set<string>();
  for (let index = 0; index < parsedRows.length; index += 1) {
    const data = parsedRows[index];
    if (!data) continue;
    const rowNumber = index + 2;
    if (data.code === '' && data.name === '') {
      summary.skipped += 1;
      continue;
    }
    if (data.code === '' || data.name === '') {
      summary.error += 1;
      rows.push({ rowNumber, code: data.code, name: data.name, status: 'error', reason: data.code === '' ? 'Scheme code is required' : 'Scheme name is required' });
      continue;
    }
    if (seenCodes.has(data.code)) {
      summary.error += 1;
      rows.push({ rowNumber, code: data.code, name: data.name, status: 'error', reason: '文件内方案编号重复' });
      continue;
    }
    seenCodes.add(data.code);
    if (existingCodes.has(data.code)) {
      summary.duplicate += 1;
      rows.push({ rowNumber, code: data.code, name: data.name, status: 'duplicate', data });
      continue;
    }
    summary.valid += 1;
    rows.push({ rowNumber, code: data.code, name: data.name, status: 'valid', data });
  }

  const inserted = await pool.query<{ id: string }>(`
    INSERT INTO scheme_imports (source_filename, preview, summary, expires_at, created_by)
    VALUES ($1, $2, $3, now() + interval '1 hour', $4)
    RETURNING id::text AS id
  `, [filename, rows, summary, adminId]);
  const importId = inserted.rows[0]?.id;
  if (!importId) throw Object.assign(new Error('Failed to create import preview'), { statusCode: 500 });
  return { importId, rows, summary };
}

export async function commitImport(pool: pg.Pool, adminId: string | null, importId: string, options: CommitImportOptions): Promise<CommitImportResult> {
  return transaction(pool, async client => {
    const imported = await client.query<{ preview: unknown }>(`
      SELECT preview
      FROM scheme_imports
      WHERE id = $1 AND status = 'pending' AND expires_at > now()
      FOR UPDATE
    `, [importId]);
    const preview = imported.rows[0]?.preview;
    if (!preview) throw Object.assign(new Error('Import preview not found or has expired'), { statusCode: 400 });
    if (!Array.isArray(preview)) throw Object.assign(new Error('Import preview is invalid'), { statusCode: 400 });

    const selectedRows = options.selectedRows && options.selectedRows.length > 0 ? new Set(options.selectedRows) : null;
    const result: CommitImportResult = { created: 0, updated: 0, failed: [] };
    for (const storedRow of preview) {
      const row = importRowFromJson(storedRow);
      if (!row || !row.data || (row.status !== 'valid' && row.status !== 'duplicate') ||
        (selectedRows !== null && !selectedRows.has(row.rowNumber))) continue;
      if (row.status === 'duplicate' && options.duplicateStrategy === 'skip') continue;
      await client.query('SAVEPOINT row_save');
      try {
        if (row.status === 'valid') {
          await client.query(insertSql, [
            row.data.code, row.data.name, row.data.parentCode, row.data.widthCm, row.data.lengthCm,
            row.data.areaSqm, row.data.heightCm, row.data.openingCount, row.data.productLine,
            row.data.style, row.data.industries, row.data.budgetTier, row.data.functionalZones,
            row.data.keyFeatures, row.data.description, row.data.keywords,
            row.data.notes, adminId, adminId,
          ]);
          result.created += 1;
        } else {
          const updateResult = await client.query(updateSql, [
            row.data.code, row.data.name, row.data.parentCode, row.data.widthCm, row.data.lengthCm,
            row.data.areaSqm, row.data.heightCm, row.data.openingCount, row.data.productLine,
            row.data.style, row.data.industries, row.data.budgetTier, row.data.functionalZones,
            row.data.keyFeatures, row.data.description, row.data.keywords,
            row.data.notes, adminId,
          ]);
          if (updateResult.rowCount === 0) {
            result.failed.push({ rowNumber: row.rowNumber, code: row.code, reason: '原方案已不存在，请重新导入' });
          } else {
            result.updated += 1;
          }
        }
        await client.query('RELEASE SAVEPOINT row_save');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT row_save');
        result.failed.push({ rowNumber: row.rowNumber, code: row.code, reason: mapDbError(err) });
      }
    }
    await client.query("UPDATE scheme_imports SET status = 'committed', committed_at = now() WHERE id = $1", [importId]);
    return result;
  });
}
