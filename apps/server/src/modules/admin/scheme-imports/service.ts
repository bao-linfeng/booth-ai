import ExcelJS from 'exceljs';
import type pg from 'pg';
import { transaction } from '../../../infra/database.js';
import { validateSchemeDictionaryIds } from '../schemes/dictionary-ids.js';

const importDictionaries = {
  productSystemId: 'product_system', styleId: 'style', industryIds: 'industry',
  budgetTierId: 'budget_tier', zoneIds: 'functional_zone', featureIds: 'key_feature',
} as const;

type ImportDictionaryField = keyof typeof importDictionaries;

async function resolveImportLabels(client: pg.Pool | pg.PoolClient, row: ImportRow): Promise<ImportRow> {
  const result = { ...row };
  for (const [field, code] of Object.entries(importDictionaries) as [ImportDictionaryField, string][]) {
    const value = row[field];
    if (value === null) continue;
    const labels = Array.isArray(value) ? value : [value];
    if (labels.length === 0) continue;
    const matches = await client.query<{ id: string; label: string; itemValue: string }>(`
      SELECT i.id::text AS id, i.item_label AS label, i.item_value AS "itemValue"
      FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id
      WHERE d.code = $1 AND d.enabled AND i.enabled AND (i.item_label = ANY($2::text[]) OR i.item_value = ANY($2::text[]))`, [code, labels]);
    const ids = labels.map(label => matches.rows.find(item => item.label === label || item.itemValue === label)?.id);
    if (ids.some(id => !id)) throw Object.assign(new Error(`未映射的${code}标签: ${labels.filter((_, index) => !ids[index]).join('、')}`), { statusCode: 400 });
    (result as Record<ImportDictionaryField, string | string[] | null>)[field] = Array.isArray(value) ? ids as string[] : ids[0]!;
  }
  return result;
}

function validateImportedSize(row: ImportRow): void {
  for (const dimension of [row.lengthMm, row.widthMm, row.heightMm]) {
    if (dimension !== null && (!Number.isSafeInteger(dimension) || dimension <= 0 || dimension > 2147483647))
      throw Object.assign(new Error('尺寸无法精确表示为整数毫米'), { statusCode: 400 });
  }
  if (row.areaM2 !== null && (!Number.isFinite(row.areaM2) || row.areaM2 <= 0))
    throw Object.assign(new Error('面积必须为正数'), { statusCode: 400 });
  if (row.areaM2 !== null && row.lengthMm !== null && row.widthMm !== null &&
    Math.abs(row.areaM2 - row.lengthMm * row.widthMm / 1_000_000) > 0.000001)
    throw Object.assign(new Error('面积与长宽不一致'), { statusCode: 400 });
}

export interface ImportRow {
  code: string;
  name: string;
  parentCode: string | null;
  widthMm: number | null;
  lengthMm: number | null;
  areaM2: number | null;
  heightMm: number | null;
  openingCount: number | null;
  productSystemId: string | null;
  styleId: string | null;
  industryIds: string[] | null;
  budgetTierId: string | null;
  zoneIds: string[] | null;
  featureIds: string[] | null;
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
  dictionaryItemsCreated: number;
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
  return Number.isFinite(number) ? number * multiplier : NaN;
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
  const parsed: ImportRow = {
    code: cellText(row.getCell(2).value),
    name: cellText(row.getCell(3).value),
    parentCode: optionalText(row.getCell(4).value),
    widthMm: numericValue(row.getCell(6).value, 1000),
    lengthMm: numericValue(row.getCell(7).value, 1000),
    areaM2: numericValue(row.getCell(8).value),
    heightMm: numericValue(row.getCell(9).value, 1000),
    openingCount: openingCount(row.getCell(10).value),
    productSystemId: optionalText(row.getCell(11).value),
    styleId: optionalText(row.getCell(12).value),
    industryIds: listValue(row.getCell(13).value),
    budgetTierId: optionalText(row.getCell(14).value),
    zoneIds: listValue(row.getCell(15).value),
    featureIds: listValue(row.getCell(16).value),
    description: optionalText(row.getCell(17).value),
    keywords: listValue(row.getCell(18).value),
    verificationStatus: verificationStatus(row.getCell(19).value),
    notes: optionalText(row.getCell(20).value),
  };
  if (parsed.areaM2 === null && parsed.lengthMm !== null && parsed.widthMm !== null) {
    parsed.areaM2 = parsed.lengthMm * parsed.widthMm / 1_000_000;
  }
  return parsed;
}

function parseError(): Error & { statusCode: number } {
  return Object.assign(new Error('Failed to parse Excel file'), { statusCode: 400 });
}

const insertSql = `
  INSERT INTO schemes (
    code, name, parent_code, width_mm, length_mm, area_sqm, height_mm,
    opening_count, product_system_id, style_id, industry_ids, budget_tier_id,
    zone_ids, feature_ids, description, keywords,
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
    width_mm = $4,
    length_mm = $5,
    area_sqm = $6,
    height_mm = $7,
    opening_count = $8,
    product_system_id = $9,
    style_id = $10,
    industry_ids = $11,
    budget_tier_id = $12,
    zone_ids = $13,
    feature_ids = $14,
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

const generatedDictionaries = [
  { code: 'opening_count', name: '开口面数' },
  { code: 'booth_length', name: '展位长' },
  { code: 'booth_width', name: '展位宽' },
  { code: 'booth_height', name: '展位高' },
  { code: 'booth_area', name: '展位面积' },
] as const;

function generatedDictionaryValue(code: (typeof generatedDictionaries)[number]['code'], row: ImportRow): { value: string; label: string; sortOrder: number } | null {
  if (code === 'opening_count' && row.openingCount !== null) {
    return {
      value: String(row.openingCount),
      label: row.openingCount === 4 ? '4面开口（岛式）' : `${row.openingCount}面开口`,
      sortOrder: row.openingCount,
    };
  }
  const dimension = code === 'booth_length' ? row.lengthMm : code === 'booth_width' ? row.widthMm : code === 'booth_height' ? row.heightMm : null;
  if (dimension !== null) {
    return { value: String(dimension), label: `${dimension / 1000} m`, sortOrder: dimension };
  }
  if (code === 'booth_area' && row.areaM2 !== null) {
    return { value: String(row.areaM2), label: `${row.areaM2} ㎡`, sortOrder: Math.round(row.areaM2 * 1_000_000) };
  }
  return null;
}

async function createGeneratedDictionaryItems(client: pg.PoolClient, rows: ImportRow[]): Promise<number> {
  let created = 0;
  for (const dictionary of generatedDictionaries) {
    await client.query(
      'INSERT INTO dictionaries (code, name, type) VALUES ($1, $2, \'selection\') ON CONFLICT (code) DO NOTHING',
      [dictionary.code, dictionary.name],
    );
    const values = new Map<string, { label: string; sortOrder: number }>();
    for (const row of rows) {
      const item = generatedDictionaryValue(dictionary.code, row);
      if (item) values.set(item.value, { label: item.label, sortOrder: item.sortOrder });
    }
    for (const [value, item] of values) {
      const result = await client.query(
        `INSERT INTO dictionary_items (dictionary_id, item_value, item_label, sort_order)
         SELECT id, $2, $3, $4 FROM dictionaries WHERE code = $1
         ON CONFLICT (dictionary_id, item_value) DO NOTHING`,
        [dictionary.code, value, item.label, item.sortOrder],
      );
      created += result.rowCount ?? 0;
    }
  }
  return created;
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
    try {
      validateImportedSize(data);
      parsedRows[index] = await resolveImportLabels(pool, data);
    } catch (error) {
      summary.error += 1;
      rows.push({ rowNumber, code: data.code, name: data.name, status: 'error', reason: error instanceof Error ? error.message : '导入数据无效' });
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
      rows.push({ rowNumber, code: data.code, name: data.name, status: 'duplicate', data: parsedRows[index] });
      continue;
    }
    summary.valid += 1;
    rows.push({ rowNumber, code: data.code, name: data.name, status: 'valid', data: parsedRows[index] });
  }

  const inserted = await pool.query<{ id: string }>(`
    INSERT INTO scheme_imports (source_filename, preview, summary, expires_at, created_by)
    VALUES ($1, $2, $3, now() + interval '1 hour', $4)
    RETURNING id::text AS id
  `, [filename, JSON.stringify(rows), JSON.stringify(summary), adminId]);
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
    const result: CommitImportResult = { created: 0, updated: 0, dictionaryItemsCreated: 0, failed: [] };
    const committedRows: ImportRow[] = [];
    for (const storedRow of preview) {
      const row = importRowFromJson(storedRow);
      if (!row || !row.data || (row.status !== 'valid' && row.status !== 'duplicate') ||
        (selectedRows !== null && !selectedRows.has(row.rowNumber))) continue;
      if (row.status === 'duplicate' && options.duplicateStrategy === 'skip') continue;
      await client.query('SAVEPOINT row_save');
      try {
        validateImportedSize(row.data);
        await validateSchemeDictionaryIds(client, row.data);
        if (row.status === 'valid') {
          await client.query(insertSql, [
            row.data.code, row.data.name, row.data.parentCode, row.data.widthMm, row.data.lengthMm,
            row.data.areaM2, row.data.heightMm, row.data.openingCount, row.data.productSystemId,
            row.data.styleId, row.data.industryIds ?? [], row.data.budgetTierId, row.data.zoneIds ?? [],
            row.data.featureIds ?? [], row.data.description, row.data.keywords,
            row.data.notes, adminId, adminId,
          ]);
           result.created += 1;
           committedRows.push(row.data);
        } else {
          const updateResult = await client.query(updateSql, [
            row.data.code, row.data.name, row.data.parentCode, row.data.widthMm, row.data.lengthMm,
            row.data.areaM2, row.data.heightMm, row.data.openingCount, row.data.productSystemId,
            row.data.styleId, row.data.industryIds ?? [], row.data.budgetTierId, row.data.zoneIds ?? [],
            row.data.featureIds ?? [], row.data.description, row.data.keywords,
            row.data.notes, adminId,
          ]);
          if (updateResult.rowCount === 0) {
            result.failed.push({ rowNumber: row.rowNumber, code: row.code, reason: '原方案已不存在，请重新导入' });
          } else {
            result.updated += 1;
            committedRows.push(row.data);
          }
        }
        await client.query('RELEASE SAVEPOINT row_save');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT row_save');
        result.failed.push({ rowNumber: row.rowNumber, code: row.code, reason: err instanceof Error && 'statusCode' in err && err.statusCode === 400 ? err.message : mapDbError(err) });
      }
    }
    result.dictionaryItemsCreated = await createGeneratedDictionaryItems(client, committedRows);
    await client.query("UPDATE scheme_imports SET status = 'committed', committed_at = now() WHERE id = $1", [importId]);
    return result;
  });
}
