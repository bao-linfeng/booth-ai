import ExcelJS from 'exceljs';
import { quantityFor } from './quantity.js';
import type { BomItemInput, BomRecord, MeasurementKind, ImportIssue, ParsedBom } from './types.js';

export type { ImportIssue, ParsedBom } from './types.js';

const importHeaders = ['产品名称', '型号', '规格/mm', '数量', '计量类型', '单价/¥', '总价/¥', '重量合计/kg', 'ERP编码'];
const exportHeaders = ['产品名称', '型号', '规格/mm', '数量', '单价/¥', '总价/¥', '重量合计/kg', 'ERP编码'];
const sourceUnits: Record<MeasurementKind, string> = { count: '件', length: 'mm', area: 'mm²' };
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
  let sheet: ExcelJS.Worksheet | undefined;
  let columns: Map<string, number> | undefined;
  for (const candidate of workbook.worksheets) {
    const headers = candidate.getRow(1);
    if (headers.cellCount > 32) continue;
    const found = new Map<string, number>();
    try {
      for (let index = 1; index <= headers.cellCount; index++) {
        const header = text(headers.getCell(index));
        if (!importHeaders.includes(header)) continue;
        if (found.has(header)) { found.clear(); break; }
        found.set(header, index);
      }
    } catch { continue; }
    if (importHeaders.every(header => found.has(header))) { sheet = candidate; columns = found; break; }
  }
  if (!sheet || !columns) throw Object.assign(new Error('Unsupported workbook template'), { statusCode: 422, reason: 'UNSUPPORTED_BOM_TEMPLATE' });
  if (sheet.rowCount > 10001) throw Object.assign(new Error('Too many rows'), { statusCode: 422, reason: 'INVALID_WORKBOOK' });
  const info = workbook.getWorksheet('说明');
  if (info) {
    const sourceCode = text(info.getCell('B1'));
    if (sourceCode && sourceCode !== schemeCode) throw Object.assign(new Error('Scheme code mismatch'), { statusCode: 422, reason: 'SCHEME_CODE_MISMATCH' });
  }
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const items: BomItemInput[] = [];
  const numericErpRows: number[] = [];
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    const cell = (header: string) => row.getCell(columns.get(header)!);
    let name: string, quantity: string, model: string, specification: string, erp: string, measurementKind: string;
    let unitPrice: string, totalPrice: string, totalWeightKg: string;
    if (row.cellCount > 32) { errors.push({code:'ROW_INVALID',sheet:sheet.name,row:number,message:'超出支持的列范围'}); continue; }
    try {
      name = text(cell('产品名称')); model = text(cell('型号')); specification = text(cell('规格/mm'));
      quantity = text(cell('数量')); measurementKind = text(cell('计量类型'));
      unitPrice = text(cell('单价/¥')); totalPrice = text(cell('总价/¥'));
      totalWeightKg = text(cell('重量合计/kg')); erp = text(cell('ERP编码'));
      if (![name,model,specification,quantity,measurementKind,unitPrice,totalPrice,totalWeightKg,erp].some(Boolean)) continue;
    } catch {
      errors.push({ code: 'FORMULA_UNSUPPORTED', sheet: sheet.name, row: number, message: '业务列包含公式或不支持的单元格类型' });
      continue;
    }
    const decimal = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
    const kind = (['count', 'length', 'area'] as const).find(value => value === measurementKind);
    if (!kind) {
      errors.push({ code: 'MEASUREMENT_KIND_INVALID', sheet: sheet.name, row: number, field: 'measurementKind', message: '每行须填写计量类型 count/length/area' });
      continue;
    }
    const sourceUnit = sourceUnits[kind];
    if (!name || !decimal.test(quantity) || Number(quantity) <= 0 || (kind === 'count' && !Number.isInteger(Number(quantity))) ||
      !unitPrice || !decimal.test(unitPrice) || !totalPrice || !decimal.test(totalPrice) ||
      !totalWeightKg || !decimal.test(totalWeightKg) || !erp) {
      errors.push({ code: 'ROW_INVALID', sheet: sheet.name, row: number, message: '产品、正数数量（个数须为整数）、单价、总价、重量或 ERP 编码缺失/非法' });
      continue;
    }
    try { quantityFor(quantity, kind); }
    catch {
      errors.push({ code: 'ROW_INVALID', sheet: sheet.name, row: number, field: 'sourceQuantity', message: '换算后数量超出支持范围或精度' });
      continue;
    }
    if (cell('ERP编码').type === ExcelJS.ValueType.Number) {
      numericErpRows.push(number);
    }
    items.push({ productName: name, productModel: model || null, specificationMm: specification || null, sourceQuantity: quantity, sourceUnit, measurementKind: kind, unitPrice, totalPrice, totalWeightKg, erpCode: erp, sourceSheet: sheet.name, sourceRow: number });
    if (!model) warnings.push({ code: 'OPTIONAL_FIELD_MISSING', sheet: sheet.name, row: number, message: '型号缺失，请核对' });
  }
  if (numericErpRows.length) {
    const range = numericErpRows.length === 1 ? `第 ${numericErpRows[0]} 行` : `第 ${numericErpRows[0]} 至 ${numericErpRows.at(-1)} 行中有 ${numericErpRows.length} 行`;
    warnings.unshift({ code: 'NUMERIC_ERP_CODE', sheet: sheet.name, message: `${range}的 ERP 编码为数值单元格，将按当前数值导入；若原编码包含前导零，源文件中已无法恢复，请核对` });
  }
  return { items, errors, warnings };
}

function safeText(value: string | null | undefined): string {
  return value && /^[=+\-@]/.test(value) ? `'${value}` : value ?? '';
}

export async function exportBomWorkbook(bom: BomRecord, schemeCode: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('简化清单');
  sheet.addRow(exportHeaders);
  for (const item of bom.items) {
    const row = sheet.addRow([safeText(item.productName), safeText(item.productModel), safeText(item.specificationMm), Number(item.quantity), null, null, item.totalWeightKg == null ? null : Number(item.totalWeightKg), safeText(item.erpCode)]);
    for (const index of [1, 2, 3, 8]) row.getCell(index).numFmt = '@';
  }
  const info = workbook.addWorksheet('说明');
  info.addRow(['方案编号', safeText(schemeCode)]);
  info.addRow(['清单修订', bom.revision]);
  info.addRow(['核验时间', bom.verifiedAt ?? '']);
  info.addRow(['说明', '单价、总价由客服提供；数量及单位以核验结果为准，原始价格不包含在客户文件中。']);
  for (const item of bom.items) {
    const pricingUnit = item.measurementKind === 'length' ? 'm' : item.measurementKind === 'area' ? 'm²' : item.sourceUnit;
    const conversion = item.sourceUnit === 'mm' ? 'mm_to_m' : ['mm2','mm²'].includes(item.sourceUnit) ? 'mm2_to_m2' : 'identity';
    info.addRow([item.ordinal, safeText(item.sourceUnit), pricingUnit, conversion]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
