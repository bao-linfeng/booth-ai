import ExcelJS from 'exceljs';
import { domainError } from '../../../lib/errors.js';
import type { ImportRow, ImportTemplateMismatch, ParsedImportRow } from './types.js';

interface XlsxLoader {
  load(buffer: Buffer): Promise<ExcelJS.Workbook>;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value)
      return value.richText
        .map(part => part.text)
        .join('')
        .trim();
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
  return text
    .split(/[,，]/)
    .map(item => item.trim())
    .filter(item => item !== '');
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

/** 模板列（自 A 列起，第 1 行为表头）：解析、表头校验与模板生成共用此表，列序即解析位置。 */
export const importColumns = [
  { key: 'serial', header: '序号', note: '可选，仅便于核对，不导入' },
  { key: 'code', header: '方案编号', note: '必填，文件内不可重复；已存在的编号按预览时选择的策略覆盖或跳过' },
  { key: 'name', header: '方案名称', note: '必填' },
  { key: 'parentCode', header: '母方案编号', note: '可选，填写已存在的方案编号' },
  { key: 'bomFile', header: '配套清单文件', note: '仅供记录，不导入；清单请在方案详情中按方案导入' },
  { key: 'lengthMm', header: '展位长(m)', note: '单位米，导入时换算为毫米' },
  { key: 'widthMm', header: '展位宽(m)', note: '单位米，导入时换算为毫米' },
  { key: 'areaM2', header: '展位面积(㎡)', note: '可留空，按长×宽计算；填写时须与长宽一致' },
  { key: 'heightMm', header: '展位高度(m)', note: '单位米，导入时换算为毫米' },
  { key: 'openingCount', header: '开口面数', note: '1面～4面，或“岛式”（按 4 面）' },
  { key: 'productSystemId', header: '产品体系', note: '单选，取值见“下拉选项”' },
  { key: 'styleId', header: '风格', note: '单选，取值见“下拉选项”' },
  { key: 'industryIds', header: '适用行业', note: '可多选，逗号分隔，取值见“下拉选项”' },
  { key: 'budgetTierId', header: '预算档位', note: '单选，取值见“下拉选项”' },
  { key: 'zoneIds', header: '功能分区', note: '可多选，逗号分隔，取值见“下拉选项”' },
  { key: 'featureIds', header: '关键特征', note: '可多选，逗号分隔，取值见“下拉选项”' },
  { key: 'description', header: '一句话描述', note: '可选' },
  { key: 'keywords', header: '关键词', note: '可选，逗号分隔' },
  { key: 'verificationStatus', header: '核验状态', note: '仅供记录；导入或覆盖后方案均为待核验' },
  { key: 'notes', header: '备注', note: '可选，仅后台可见' },
] as const;

type ImportColumnKey = (typeof importColumns)[number]['key'];

const columnIndex = Object.fromEntries(importColumns.map((column, index) => [column.key, index + 1])) as Record<ImportColumnKey, number>;

function parseRow(row: ExcelJS.Row): ImportRow {
  const cell = (key: ImportColumnKey) => row.getCell(columnIndex[key]).value;
  const parsed: ImportRow = {
    code: cellText(cell('code')),
    name: cellText(cell('name')),
    parentCode: optionalText(cell('parentCode')),
    lengthMm: numericValue(cell('lengthMm'), 1000),
    widthMm: numericValue(cell('widthMm'), 1000),
    areaM2: numericValue(cell('areaM2')),
    heightMm: numericValue(cell('heightMm'), 1000),
    openingCount: openingCount(cell('openingCount')),
    productSystemId: optionalText(cell('productSystemId')),
    styleId: optionalText(cell('styleId')),
    industryIds: listValue(cell('industryIds')),
    budgetTierId: optionalText(cell('budgetTierId')),
    zoneIds: listValue(cell('zoneIds')),
    featureIds: listValue(cell('featureIds')),
    description: optionalText(cell('description')),
    keywords: listValue(cell('keywords')),
    verificationStatus: verificationStatus(cell('verificationStatus')),
    notes: optionalText(cell('notes')),
  };
  if (parsed.areaM2 === null && parsed.lengthMm !== null && parsed.widthMm !== null) {
    parsed.areaM2 = (parsed.lengthMm * parsed.widthMm) / 1_000_000;
  }
  return parsed;
}

function normalizeHeader(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '');
}

/** 第 1 行逐列与模板表头比对（忽略空白与全半角差异），返回首个不一致的列。 */
function headerMismatch(worksheet: ExcelJS.Worksheet): ImportTemplateMismatch | null {
  const header = worksheet.getRow(1);
  for (const [index, column] of importColumns.entries()) {
    const actual = cellText(header.getCell(index + 1).value);
    if (normalizeHeader(actual) !== normalizeHeader(column.header)) {
      return { sheetName: worksheet.name, column: String.fromCharCode(65 + index), expected: column.header, actual: actual.slice(0, 50) };
    }
  }
  return null;
}

/** 单次导入的数据工作表与扫描行数上限（含空行，不含表头），须与管理端提示一致。 */
export const maxImportSheets = 10;
export const maxImportRows = 2000;

/** 最后一个含值的行号；仅有格式的尾部空行不计入，避免按 rowCount 扫描到异常远的行。 */
function lastValueRow(worksheet: ExcelJS.Worksheet): number {
  let last = 0;
  worksheet.eachRow((_row, rowNumber) => {
    last = rowNumber;
  });
  return last;
}

/** 读取模板中的方案行（每个工作表从第 2 行起），保留来源工作表与原始行号；"说明"/"选项"工作表不参与导入，其余工作表须与模板表头一致。 */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await (workbook.xlsx as unknown as XlsxLoader).load(buffer);
  } catch {
    throw domainError('IMPORT_FILE_INVALID', 400);
  }

  // 完全没有内容的工作表（如默认的空白 Sheet）直接忽略，其余数据工作表必须使用模板表头
  const ranges = workbook.worksheets
    .filter(worksheet => !worksheet.name.includes('说明') && !worksheet.name.includes('选项'))
    .map(worksheet => ({ worksheet, lastRow: lastValueRow(worksheet) }))
    .filter(({ lastRow }) => lastRow > 0);
  if (ranges.length > maxImportSheets) throw domainError('IMPORT_TOO_MANY_SHEETS', 400);
  for (const { worksheet } of ranges) {
    const mismatch = headerMismatch(worksheet);
    if (mismatch) throw Object.assign(domainError('IMPORT_TEMPLATE_MISMATCH', 400), { details: mismatch });
  }
  if (ranges.reduce((total, { lastRow }) => total + Math.max(lastRow - 1, 0), 0) > maxImportRows)
    throw domainError('IMPORT_TOO_MANY_ROWS', 400);

  const rows: ParsedImportRow[] = [];
  for (const { worksheet, lastRow } of ranges) {
    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
      rows.push({ sheetName: worksheet.name, rowNumber, data: parseRow(worksheet.getRow(rowNumber)) });
    }
  }
  return rows;
}
