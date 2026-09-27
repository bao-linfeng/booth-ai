import ExcelJS from 'exceljs';
import type { BomItemInput, BomRecord, UnitRuleInput } from './service.js';

export interface ImportIssue { code: string; sheet?: string; row?: number; field?: string; message: string }
export interface ParsedBom { items: BomItemInput[]; unitRules: UnitRuleInput[]; errors: ImportIssue[]; warnings: ImportIssue[] }

const headers = ['序号', '产品名称', '产品型号', '尺寸规格(mm)', '数量', '单价', '总价', 'ERP编码'];
function inspectZip(buffer: Buffer): void {
  if (buffer.length > 10 * 1024 * 1024) throw Object.assign(new Error('Workbook too large'), {statusCode:422,reason:'INVALID_WORKBOOK'});
  let expanded = 0; let entries = 0;
  const footer = buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if (footer < 0 || footer + 22 > buffer.length) throw Object.assign(new Error('Invalid ZIP directory'), {statusCode:422,reason:'INVALID_WORKBOOK'});
  const count = buffer.readUInt16LE(footer + 10);
  if (count > 200 || buffer.readUInt16LE(footer + 8) !== count) throw Object.assign(new Error('Invalid ZIP directory'), {statusCode:422,reason:'INVALID_WORKBOOK'});
  let position = buffer.readUInt32LE(footer + 16);
  for (let entry = 0; entry < count; entry++) {
    if (position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50) throw Object.assign(new Error('Invalid ZIP directory'), {statusCode:422,reason:'INVALID_WORKBOOK'});
    const flags = buffer.readUInt16LE(position + 8);
    const nameLength = buffer.readUInt16LE(position + 28);
    if (position + 46 + nameLength > buffer.length) throw Object.assign(new Error('Invalid ZIP directory'), {statusCode:422,reason:'INVALID_WORKBOOK'});
    const filename = buffer.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    if (/(?:^|\/)(?:vbaProject\.bin|externalLinks\/|embeddings\/|connections\.xml)/i.test(filename)) throw Object.assign(new Error('Unsafe workbook component'), {statusCode:422,reason:'INVALID_WORKBOOK'});
    const compressed = buffer.readUInt32LE(position + 20);
    const uncompressed = buffer.readUInt32LE(position + 24);
    if (flags & 1 || compressed === 0xffffffff || uncompressed === 0xffffffff) throw Object.assign(new Error('Unsupported ZIP structure'), {statusCode:422,reason:'INVALID_WORKBOOK'});
    expanded += uncompressed; entries++;
    if (expanded > 100 * 1024 * 1024 || entries > 200 || (compressed && uncompressed / compressed > 100)) throw Object.assign(new Error('Workbook expansion limit'), {statusCode:422,reason:'INVALID_WORKBOOK'});
    position += 46 + nameLength + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
  }
  if (!entries) throw Object.assign(new Error('Invalid ZIP structure'), {statusCode:422,reason:'INVALID_WORKBOOK'});
}
const text = (cell: ExcelJS.Cell): string => {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'formula' in value) throw new Error('FORMULA_UNSUPPORTED');
  if (typeof value === 'object' && 'richText' in value) return value.richText.map(part => part.text).join('').trim();
  if (typeof value === 'object' && 'text' in value) return String(value.text).trim();
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('CELL_UNSUPPORTED');
  return String(value).trim();
};

export async function parseBomWorkbook(buffer: Buffer, schemeCode: string): Promise<ParsedBom> {
  inspectZip(buffer);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch { throw Object.assign(new Error('Invalid or encrypted workbook'), { statusCode: 422, reason: 'INVALID_WORKBOOK' }); }
  if (workbook.worksheets.length > 10) throw Object.assign(new Error('Too many sheets'), { statusCode: 422, reason: 'INVALID_WORKBOOK' });
  const sheet = workbook.getWorksheet('简化清单');
  if (!sheet || headers.some((header, index) => {
    try { return text(sheet.getRow(1).getCell(index + 1)) !== header; } catch { return true; }
  })) throw Object.assign(new Error('Unsupported workbook template'), { statusCode: 422, reason: 'INVALID_WORKBOOK' });
  if (sheet.rowCount > 10001) throw Object.assign(new Error('Too many rows'), { statusCode: 422, reason: 'INVALID_WORKBOOK' });
  const info = workbook.getWorksheet('说明');
  if (info) {
    const code = text(info.getCell('B1'));
    if (code && code !== schemeCode) throw Object.assign(new Error('Scheme code mismatch'), { statusCode: 422, reason: 'SCHEME_CODE_MISMATCH' });
  }
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  if (!info || !text(info.getCell('B1'))) warnings.push({ code: 'SCHEME_CODE_MISSING_IN_SOURCE', message: '源文件未标注方案编号，请人工确认归属' });
  const items: BomItemInput[] = [];
  const units = new Set<string>();
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    let name: string, quantity: string, sourceUnit: string, model: string, specification: string, erp: string;
    if (row.cellCount > 32) { errors.push({code:'ROW_INVALID',sheet:sheet.name,row:number,message:'超出支持的列范围'}); continue; }
    try {
      name = text(row.getCell(2)); model = text(row.getCell(3)); specification = text(row.getCell(4)); erp = text(row.getCell(8));
      const raw = text(row.getCell(5));
      const match = /^([0-9]+(?:\.[0-9]+)?)\s*(mm2|mm²|m2|m²|mm|m|个|件)$/.exec(raw);
      quantity = match?.[1] ?? raw; sourceUnit = match?.[2] ?? '';
      if (!name && !raw && !model && !specification && !erp) continue;
    } catch {
      errors.push({ code: 'FORMULA_UNSUPPORTED', sheet: sheet.name, row: number, message: '业务列包含公式或不支持的单元格类型' });
      continue;
    }
    if (!name || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(quantity) || !sourceUnit || Number(quantity) <= 0 || (['个','件'].includes(sourceUnit) && Number(quantity) % 1 !== 0)) {
      errors.push({ code: 'ROW_INVALID', sheet: sheet.name, row: number, message: '产品名称或带单位的正数数量缺失/非法' });
      continue;
    }
    units.add(sourceUnit);
    items.push({ productName: name, productModel: model || null, specificationMm: specification || null, sourceQuantity: quantity, sourceUnit, erpCode: erp || null, sourceSheet: sheet.name, sourceRow: number });
    if (!model || !erp) warnings.push({ code: 'OPTIONAL_FIELD_MISSING', sheet: sheet.name, row: number, message: '型号或 ERP 编码缺失，请核对' });
  }
  const unitRules: UnitRuleInput[] = [...units].map(sourceUnit => ({
    measurementKind: sourceUnit === 'mm' || sourceUnit === 'm' ? 'length' : ['mm2', 'mm²', 'm2', 'm²'].includes(sourceUnit) ? 'area' : 'count',
    sourceUnit, pricingUnit: sourceUnit, conversionCode: 'identity',
  }));
  return { items, unitRules, errors, warnings };
}

function safeText(value: string | null | undefined): string {
  return value && /^[=+\-@]/.test(value) ? `'${value}` : value ?? '';
}

export async function exportBomWorkbook(bom: BomRecord, schemeCode: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet('简化清单');
  sheet.addRow(headers);
  for (const item of bom.items) {
    const row = sheet.addRow([item.ordinal, safeText(item.productName), safeText(item.productModel), safeText(item.specificationMm), Number(item.quantity), null, null, safeText(item.erpCode)]);
    for (const index of [2, 3, 4, 8]) row.getCell(index).numFmt = '@';
    row.getCell(7).value = { formula: `IF(F${row.number}="","",E${row.number}*F${row.number})` };
  }
  const info = workbook.addWorksheet('说明');
  info.addRow(['方案编号', safeText(schemeCode)]);
  info.addRow(['清单修订', bom.revision]);
  info.addRow(['核验时间', bom.verifiedAt ?? '']);
  info.addRow(['说明', '价格由客服提供；清单数量按核验的计量规则计算。']);
  for (const item of bom.items) {
    const rule = bom.unitRules.find(candidate => candidate.id === item.unitRuleId);
    info.addRow([item.ordinal, safeText(item.sourceUnit), safeText(rule?.pricingUnit), safeText(rule?.conversionCode)]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
