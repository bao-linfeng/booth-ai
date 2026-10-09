import ExcelJS from 'exceljs';
import { domainError } from '../../../lib/errors.js';
import type { ImportRow, ParsedImportRow } from './types.js';

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
    lengthMm: numericValue(row.getCell(6).value, 1000),
    widthMm: numericValue(row.getCell(7).value, 1000),
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

/** 单次导入的数据工作表与扫描行数上限（含空行，不含表头），须与管理端提示一致。 */
export const maxImportSheets = 10;
export const maxImportRows = 2000;

/** 最后一个含值的行号；仅有格式的尾部空行不计入，避免按 rowCount 扫描到异常远的行。 */
function lastValueRow(worksheet: ExcelJS.Worksheet): number {
  let last = 0;
  worksheet.eachRow((_row, rowNumber) => { last = rowNumber; });
  return last;
}

/** 读取模板中的方案行（每个工作表从第 2 行起），保留来源工作表与原始行号；"说明"/"选项"工作表不参与导入。 */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await (workbook.xlsx as unknown as XlsxLoader).load(buffer);
  } catch {
    throw domainError('IMPORT_FILE_INVALID', 400);
  }

  const sheets = workbook.worksheets.filter(worksheet => !worksheet.name.includes('说明') && !worksheet.name.includes('选项'));
  if (sheets.length > maxImportSheets) throw domainError('IMPORT_TOO_MANY_SHEETS', 400);
  const ranges = sheets.map(worksheet => ({ worksheet, lastRow: lastValueRow(worksheet) }));
  if (ranges.reduce((total, { lastRow }) => total + Math.max(lastRow - 1, 0), 0) > maxImportRows) throw domainError('IMPORT_TOO_MANY_ROWS', 400);

  const rows: ParsedImportRow[] = [];
  for (const { worksheet, lastRow } of ranges) {
    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
      rows.push({ sheetName: worksheet.name, rowNumber, data: parseRow(worksheet.getRow(rowNumber)) });
    }
  }
  return rows;
}
