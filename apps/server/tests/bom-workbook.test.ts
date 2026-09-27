import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { canonicalDecimal, quantityFor, type BomRecord } from '../src/modules/admin/bill-of-materials/service.js';
import { exportBomWorkbook, parseBomWorkbook } from '../src/modules/admin/bill-of-materials/workbook.js';

test('decimal conversion is exact and rejects unrepresentable fractions', () => {
  assert.equal(canonicalDecimal('1.000000'), '1');
  assert.equal(quantityFor('1200000', { measurementKind: 'area', sourceUnit: 'mm2', pricingUnit: 'm2', conversionCode: 'mm2_to_m2' }), '1.2');
  assert.equal(quantityFor('2500', { measurementKind: 'length', sourceUnit: 'mm', pricingUnit: 'm', conversionCode: 'mm_to_m' }), '2.5');
  assert.throws(() => quantityFor('0.000001', { measurementKind: 'area', sourceUnit: 'mm2', pricingUnit: 'm2', conversionCode: 'mm2_to_m2' }), /INVALID_QUANTITY/);
  assert.throws(() => canonicalDecimal('1e5'), /INVALID_QUANTITY/);
});

test('export is a fresh empty-price XLSX with controlled formulas and text-safe values', async () => {
  const bom = {
    revision: 4, verifiedAt: '2026-01-01T00:00:00.000Z', unitRules: [{ id: 'rule', sourceUnit: '个', pricingUnit: '个', conversionCode: 'identity' }],
    items: [{ ordinal: 1, productName: '=1+2', productModel: '001', specificationMm: '+5', quantity: '2.000000', erpCode: '@example', sourceUnit: '个', unitRuleId: 'rule' }],
  } as BomRecord;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await exportBomWorkbook(bom, 'EXAMPLE')) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet('简化清单')!;
  assert.equal(sheet.getCell('B2').formula, undefined);
  assert.equal(sheet.getCell('B2').value, "'=1+2");
  assert.equal(sheet.getCell('H2').value, "'@example");
  assert.equal(sheet.getCell('E2').value, 2);
  assert.equal(sheet.getCell('F2').value, null);
  assert.equal(sheet.getCell('G2').formula, 'IF(F2="","",E2*F2)');
});

test('parser accepts the fixed template and refuses formula input or mismatched ownership', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('简化清单');
  sheet.addRow(['序号', '产品名称', '产品型号', '尺寸规格(mm)', '数量', '单价', '总价', 'ERP编码']);
  sheet.addRow([1, '支架', '01', '', '2500 mm', 999, 999, '0003']);
  const info = workbook.addWorksheet('说明'); info.getCell('B1').value = 'EXAMPLE';
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseBomWorkbook(buffer, 'EXAMPLE');
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.items.map(item => [item.sourceQuantity, item.sourceUnit, item.erpCode]), [['2500','mm','0003']]);
  assert.equal(parsed.unitRules[0]?.conversionCode, 'identity');
  await assert.rejects(parseBomWorkbook(buffer, 'OTHER'), /Scheme code mismatch/);
  sheet.getCell('E2').value = { formula:'1+1',result:2 };
  const formula = await parseBomWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), 'EXAMPLE');
  assert.equal(formula.errors[0]?.code, 'FORMULA_UNSUPPORTED');
});
