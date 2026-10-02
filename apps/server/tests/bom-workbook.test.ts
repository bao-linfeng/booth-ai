import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { canonicalDecimal, quantityFor, type BomRecord } from '../src/modules/schemes/bill-of-materials/service.js';
import { exportBomWorkbook, parseBomWorkbook } from '../src/modules/schemes/bill-of-materials/workbook.js';

test('decimal conversion is exact and rejects unrepresentable fractions', () => {
  assert.equal(canonicalDecimal('1.000000'), '1');
  assert.equal(quantityFor('1200000', 'area'), '1.2');
  assert.equal(quantityFor('2500', 'length'), '2.5');
  assert.equal(quantityFor('2.5', 'length', 'm'), '2.5');
  assert.equal(quantityFor('4', 'count', '个'), '4');
  assert.throws(() => quantityFor('4', 'area', '件'), /INVALID_INPUT/);
  assert.throws(() => quantityFor('0.000001', 'area'), /INVALID_QUANTITY/);
  assert.throws(() => canonicalDecimal('1e5'), /INVALID_QUANTITY/);
});

function sourceWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(['产品名称', '型号', '规格/mm', '数量', '计量类型', '单价/¥', '总价/¥', '重量合计/kg', 'ERP编码']);
  sheet.addRow(['62布框门', 'FS62-992x2480M', '992x2480', 1, 'count', 2790.53, 2790.53, 21.3, '000123']);
  sheet.addRow(['遮光布', 'MCZ-02', '918x2330.5x1', 4, 'count', 43, 367.98, 8.56, '31801000003']);
  sheet.addRow(['遮光布', 'MCZ-02', '918x2888.5x1', 4, 'count', 43, 456.08, 10.61, '31801000003']);
  return workbook;
}

test('source workbook imports per-product measurement fields without requiring a scheme code', async () => {
  const workbook = sourceWorkbook();
  const parsed = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.items.length, 3);
  assert.deepEqual(parsed.items.map(item => [item.sourceQuantity, item.sourceUnit, item.unitPrice, item.totalPrice, item.totalWeightKg]), [
    ['1', '件', '2790.53', '2790.53', '21.3'],
    ['4', '件', '43', '367.98', '8.56'],
    ['4', '件', '43', '456.08', '10.61'],
  ]);
  assert.deepEqual(parsed.items.map(item => item.erpCode), ['000123', '31801000003', '31801000003']);
  assert.deepEqual(parsed.items.map(item => item.sourceRow), [2, 3, 4]);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.items.map(item => item.measurementKind), ['count', 'count', 'count']);
  const info = workbook.addWorksheet('说明');
  const blankInfo = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(blankInfo.warnings, []);
  info.getCell('B1').value = 'OTHER';
  await assert.rejects(parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME'), /Scheme code mismatch/);
  info.getCell('B1').value = 'SCHEME';
  workbook.getWorksheet('Sheet1')!.getCell('I2').value = 123;
  const numericErp = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(numericErp.warnings.map(issue => issue.code), ['NUMERIC_ERP_CODE']);
  assert.match(numericErp.warnings[0]!.message, /第 2 行.*按当前数值导入/);
  workbook.getWorksheet('Sheet1')!.getCell('D2').value = { formula: '2+2', result: 4 };
  const invalid = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.equal(invalid.errors[0]?.code, 'FORMULA_UNSUPPORTED');
});

test('import infers units for each product measurement type and rejects missing or invalid types', async () => {
  const workbook = sourceWorkbook();
  const sheet = workbook.getWorksheet('Sheet1')!;
  sheet.getCell('D3').value = 2500;
  sheet.getCell('E3').value = 'length';
  sheet.getCell('D4').value = 1200000;
  sheet.getCell('E4').value = 'area';
  const parsed = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.items.map(item => item.sourceUnit), ['件', 'mm', 'mm²']);
  assert.deepEqual(parsed.items.map(item => item.measurementKind), ['count', 'length', 'area']);
  sheet.getCell('E3').value = null;
  sheet.getCell('E4').value = 'invalid';
  const invalid = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(invalid.errors.map(issue => [issue.code, issue.row]), [['MEASUREMENT_KIND_INVALID', 3], ['MEASUREMENT_KIND_INVALID', 4]]);
  assert.equal(invalid.items.length, 1);
  sheet.getCell('E3').value = 'length';
  sheet.getCell('E4').value = 'area';
  sheet.getCell('D3').value = 0.000001;
  const fractional = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.equal(fractional.errors[0]?.field, 'sourceQuantity');
  sheet.getCell('D3').value = 1.5;
  sheet.getCell('E3').value = 'count';
  const fractionalCount = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.equal(fractionalCount.errors[0]?.code, 'ROW_INVALID');
  sheet.getCell('E1').value = null;
  await assert.rejects(parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME'), { message: 'Unsupported workbook template', reason: 'UNSUPPORTED_BOM_TEMPLATE', statusCode: 422 });
});

test('import reads required fields by header name regardless of their positions', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('调整列序');
  sheet.addRow(['ERP编码', '额外说明', '计量类型', '重量合计/kg', '数量', '产品名称', '总价/¥', '规格/mm', '单价/¥', '型号']);
  sheet.addRow(['000123', '忽略此列', 'length', 250, 2500, '杆件', 88, '2500', 44, 'L-01']);
  sheet.addRow([456, null, 'area', 2, 1200000, '面板', 30, '1200', 15, 'A-02']);
  const parsed = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.items.map(item => [item.productName, item.productModel, item.specificationMm, item.sourceQuantity, item.sourceUnit, item.unitPrice, item.totalPrice, item.totalWeightKg, item.erpCode]), [
    ['杆件', 'L-01', '2500', '2500', 'mm', '44', '88', '250', '000123'],
    ['面板', 'A-02', '1200', '1200000', 'mm²', '15', '30', '2', '456'],
  ]);
  assert.deepEqual(parsed.warnings.map(issue => [issue.code, issue.row]), [['NUMERIC_ERP_CODE', undefined]]);
  assert.match(parsed.warnings[0]!.message, /第 3 行/);
});

test('numeric ERP cells in a source workbook produce one actionable warning', async () => {
  const workbook = sourceWorkbook();
  const sheet = workbook.getWorksheet('Sheet1')!;
  sheet.getCell('I2').value = 12300000219;
  sheet.getCell('I3').value = 31801000003;
  sheet.getCell('I4').value = 31801000003;
  const parsed = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.items.map(item => item.erpCode), ['12300000219', '31801000003', '31801000003']);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0]!.message, /第 2 至 4 行中有 3 行.*前导零/);
});

test('import rejects duplicate required headers rather than silently reading an ambiguous column', async () => {
  const workbook = sourceWorkbook();
  const sheet = workbook.getWorksheet('Sheet1')!;
  sheet.getCell('J1').value = '数量';
  await assert.rejects(parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME'), { reason: 'UNSUPPORTED_BOM_TEMPLATE', statusCode: 422 });
});

test('customer export has source columns and weight but no price values or formulas', async () => {
  const bom = {
    revision: 4, verifiedAt: '2026-01-01T00:00:00.000Z',
    items: [{ ordinal: 1, productName: '=1+2', productModel: '001', specificationMm: '+5', quantity: '4.000000', erpCode: '@example', sourceUnit: '件', measurementKind: 'count', unitPrice: '43.000000', totalPrice: '367.980000', totalWeightKg: '8.560000' }],
  } as BomRecord;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exportBomWorkbook(bom, 'EXAMPLE')) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet('简化清单')!;
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => sheet.getRow(1).getCell(index + 1).value), ['产品名称', '型号', '规格/mm', '数量', '单价/¥', '总价/¥', '重量合计/kg', 'ERP编码']);
  assert.equal(sheet.getCell('A2').value, "'=1+2");
  assert.equal(sheet.getCell('H2').value, "'@example");
  assert.equal(sheet.getCell('D2').value, 4);
  assert.equal(sheet.getCell('E2').value, null);
  assert.equal(sheet.getCell('F2').value, null);
  assert.equal(sheet.getCell('F2').formula, undefined);
  assert.equal(sheet.getCell('G2').value, 8.56);
  assert.ok(!JSON.stringify(workbook.worksheets.map(tab => tab.getSheetValues())).includes('367.98'));
});
