import ExcelJS from 'exceljs';
import type pg from 'pg';

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

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; code: string; reason: string }[];
}

interface UpsertResult {
  created: boolean;
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

const upsertSql = `
  INSERT INTO schemes (
    code, name, parent_code, width_cm, length_cm, area_sqm, height_cm,
    opening_count, product_line, style, industries, budget_tier,
    functional_zones, key_features, description, keywords,
    verification_status, notes, created_by, updated_by
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
  ) ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    parent_code = EXCLUDED.parent_code,
    width_cm = EXCLUDED.width_cm,
    length_cm = EXCLUDED.length_cm,
    area_sqm = EXCLUDED.area_sqm,
    height_cm = EXCLUDED.height_cm,
    opening_count = EXCLUDED.opening_count,
    product_line = EXCLUDED.product_line,
    style = EXCLUDED.style,
    industries = EXCLUDED.industries,
    budget_tier = EXCLUDED.budget_tier,
    functional_zones = EXCLUDED.functional_zones,
    key_features = EXCLUDED.key_features,
    description = EXCLUDED.description,
    keywords = EXCLUDED.keywords,
    verification_status = EXCLUDED.verification_status,
    notes = EXCLUDED.notes,
    updated_by = EXCLUDED.updated_by,
    updated_at = now(),
    revision = schemes.revision + 1
  RETURNING (xmax = 0) AS created
`;

export async function importSchemesFromBuffer(pool: pg.Pool, adminId: string | null, buffer: Buffer): Promise<ImportResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await (workbook.xlsx as unknown as XlsxLoader).load(buffer);
  } catch {
    throw parseError();
  }

  const result: ImportResult = { total: 0, created: 0, updated: 0, skipped: 0, errors: [] };
  for (const worksheet of workbook.worksheets) {
    if (worksheet.name.includes('说明') || worksheet.name.includes('选项')) continue;
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = parseRow(worksheet.getRow(rowNumber));
      result.total += 1;
      if (row.code === '' || row.name === '') {
        result.skipped += 1;
        continue;
      }
      try {
        const values: unknown[] = [
          row.code, row.name, row.parentCode, row.widthCm, row.lengthCm, row.areaSqm, row.heightCm,
          row.openingCount, row.productLine, row.style, row.industries, row.budgetTier,
          row.functionalZones, row.keyFeatures, row.description, row.keywords,
          row.verificationStatus, row.notes, adminId, adminId,
        ];
        const queryResult = await pool.query<UpsertResult>(upsertSql, values);
        if (queryResult.rows[0]?.created) result.created += 1;
        else result.updated += 1;
      } catch (error) {
        result.errors.push({ row: rowNumber, code: row.code, reason: error instanceof Error ? error.message : 'Unknown database error' });
      }
    }
  }
  return result;
}
