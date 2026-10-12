import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { canonicalDecimal, quantityFor } from '../../src/modules/schemes/bill-of-materials/quantity.js';
import type { BomRecord } from '../../src/modules/schemes/bill-of-materials/types.js';
import { exportBomWorkbook, parseBomWorkbook } from '../../src/modules/schemes/bill-of-materials/workbook.js';

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
  const sheet = workbook.addWorksheet('简化清单');
  sheet.addRow(['序号', '产品名称', '产品型号', '尺寸规格(mm)', '数量', '单价', '总价', 'ERP编码']);
  sheet.addRow(Array(8).fill('一、展位主框架及配件清单'));
  sheet.mergeCells('A2:H2');
  sheet.addRow([1, '62布框门', 'FS62-992x2480M', null, '1', 2790.53, { formula: 'E3*F3', result: 2790.53 }, '000123']);
  sheet.addRow(Array(8).fill('62封盖'));
  sheet.addRow([2, '遮光布', 'MCZ-02', '918×2330.5', '4', null, { formula: 'IF(OR(E5="",F5=""),"",E5*F5)', result: '' }, '31801000003']);
  sheet.addRow([3, null, 'DZ-13', null, '2', null, { formula: 'IF(OR(E6="",F6=""),"",E6*F6)' }, null]);
  sheet.addRow([4, '遮光布', 'MCZ-02', '992×1984', null, null, null, '31801000003']);
  return workbook;
}

test('simplified source sheet skips group rows, keeps cached prices and defaults to counted items', async () => {
  const workbook = sourceWorkbook();
  const parsed = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.items.map(item => [
      item.sourceRow,
      item.productName,
      item.productModel,
      item.specificationMm,
      item.sourceQuantity,
      item.sourceUnit,
      item.measurementKind,
      item.unitPrice,
      item.totalPrice,
      item.totalWeightKg,
      item.erpCode,
    ]),
    [
      [3, '62布框门', 'FS62-992x2480M', null, '1', '件', 'count', '2790.53', '2790.53', null, '000123'],
      [5, '遮光布', 'MCZ-02', '918×2330.5', '4', '件', 'count', null, null, null, '31801000003'],
      [6, 'DZ-13', 'DZ-13', null, '2', '件', 'count', null, null, null, null],
    ],
  );
  assert.deepEqual(
    parsed.warnings.map(issue => [issue.code, issue.row]),
    [
      ['PRODUCT_NAME_MISSING', 6],
      ['ERP_CODE_MISSING', 6],
      ['QUANTITY_MISSING', 7],
    ],
  );
  const info = workbook.addWorksheet('说明');
  const blankInfo = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.equal(blankInfo.items.length, 3);
  info.getCell('B1').value = 'OTHER';
  await assert.rejects(parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME'), /Scheme code mismatch/);
});

test('import rejects formulas outside price columns and non-integer or invalid values', async () => {
  const workbook = sourceWorkbook();
  const sheet = workbook.getWorksheet('简化清单')!;
  sheet.getCell('E3').value = { formula: '2+2', result: 4 };
  sheet.getCell('E5').value = '1.5';
  sheet.getCell('F6').value = '面议';
  sheet.getCell('B7').value = null;
  sheet.getCell('C7').value = null;
  const invalid = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(
    invalid.errors.map(issue => [issue.code, issue.row]),
    [
      ['FORMULA_UNSUPPORTED', 3],
      ['ROW_INVALID', 5],
      ['ROW_INVALID', 6],
      ['ROW_INVALID', 7],
    ],
  );
  assert.equal(invalid.items.length, 0);
});

test('import reads required fields by header name regardless of their positions', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('调整列序');
  sheet.addRow(['ERP编码', '额外说明', '总价', '数量', '产品名称', '尺寸规格（mm）', '单价', '产品型号']);
  sheet.addRow(['000123', '忽略此列', 88, 2, '杆件', '2500', 44, 'L-01']);
  const parsed = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.items.map(item => [
      item.productName,
      item.productModel,
      item.specificationMm,
      item.sourceQuantity,
      item.unitPrice,
      item.totalPrice,
      item.erpCode,
    ]),
    [['杆件', 'L-01', '2500', '2', '44', '88', '000123']],
  );
});

test('numeric ERP cells in a source workbook produce one actionable warning', async () => {
  const workbook = sourceWorkbook();
  const sheet = workbook.getWorksheet('简化清单')!;
  sheet.getCell('H3').value = 12300000219;
  sheet.getCell('H5').value = 31801000003;
  const parsed = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.items.map(item => item.erpCode),
    ['12300000219', '31801000003', null],
  );
  assert.equal(parsed.warnings[0]?.code, 'NUMERIC_ERP_CODE');
  assert.match(parsed.warnings[0]!.message, /第 3 至 5 行中有 2 行.*前导零/);
});

test('import rejects missing or duplicate required headers rather than guessing a column', async () => {
  const workbook = sourceWorkbook();
  const sheet = workbook.getWorksheet('简化清单')!;
  sheet.getCell('I1').value = '数量';
  await assert.rejects(parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME'), {
    reason: 'UNSUPPORTED_BOM_TEMPLATE',
    statusCode: 422,
  });
  sheet.getCell('I1').value = null;
  sheet.getCell('C1').value = '型号';
  await assert.rejects(parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'SCHEME'), {
    message: 'Unsupported workbook template',
    reason: 'UNSUPPORTED_BOM_TEMPLATE',
    statusCode: 422,
  });
});

test('customer export has source columns and weight but no price values or formulas', async () => {
  const bom = {
    revision: 4,
    verifiedAt: '2026-01-01T00:00:00.000Z',
    items: [
      {
        ordinal: 1,
        productName: '=1+2',
        productModel: '001',
        specificationMm: '+5',
        quantity: '4.000000',
        erpCode: '@example',
        sourceUnit: '件',
        measurementKind: 'count',
        unitPrice: '43.000000',
        totalPrice: '367.980000',
        totalWeightKg: '8.560000',
      },
    ],
  } as BomRecord;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exportBomWorkbook(bom, 'EXAMPLE')) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet('简化清单')!;
  assert.deepEqual(
    Array.from({ length: 8 }, (_, index) => sheet.getRow(1).getCell(index + 1).value),
    ['产品名称', '型号', '规格/mm', '数量', '单价/¥', '总价/¥', '重量合计/kg', 'ERP编码'],
  );
  assert.equal(sheet.getCell('A2').value, "'=1+2");
  assert.equal(sheet.getCell('H2').value, "'@example");
  assert.equal(sheet.getCell('D2').value, 4);
  assert.equal(sheet.getCell('E2').value, null);
  assert.equal(sheet.getCell('F2').value, null);
  assert.equal(sheet.getCell('F2').formula, undefined);
  assert.equal(sheet.getCell('G2').value, 8.56);
  assert.ok(!JSON.stringify(workbook.worksheets.map(tab => tab.getSheetValues())).includes('367.98'));
});

test('workbook size is limited at the upload boundary, not by the parser', async () => {
  const source = Buffer.from(await sourceWorkbook().xlsx.writeBuffer());
  const parsed = await parseBomWorkbook(Buffer.concat([source, Buffer.alloc(15 * 1024 * 1024)]), 'SCHEME');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.items.length, 3);
});
