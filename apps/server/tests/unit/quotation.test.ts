import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { calculateQuotation, decimalUnits, lineAmount, localCalendarDate, type QuotationInput, type QuotationItem, type SavedQuotation } from '../../src/modules/projects/quotation.js';
import { quotationWorkbook } from '../../src/modules/projects/quotation-workbook.js';
import type { BomSnapshotItem } from '../../src/modules/projects/snapshot.js';

const bom: BomSnapshotItem[] = [{ id: 'bom-line', ordinal: 1, productName: '杆件', productModel: 'LT-1', specificationMm: '1000', quantity: '3.000000', pricingUnit: 'm', erpCode: 'ERP-1' }];

function item(overrides: Partial<QuotationItem> = {}): QuotationItem {
  return { clientLineId: 'line-1', kind: 'material', bomItemId: 'bom-line', name: '杆件', model: 'LT-1', specificationMm: '1000', quantity: '3', pricingUnit: 'm', unitPrice: '0.335', ...overrides };
}

function input(overrides: Partial<QuotationInput> = {}): QuotationInput {
  return { requestKey: 'quotation-test', expectedRevision: 1, expectedQuotationRevision: 0, currency: 'CNY', priceBasis: 'included', validUntil: '2026-12-31', validityTimeZone: 'Asia/Shanghai', items: [item()], terms: '付款后发货', inclusions: '物料', exclusions: '运输和安装', changeReason: '首次报价', ...overrides };
}

function saved(value: QuotationInput): SavedQuotation {
  return { ...calculateQuotation(value, bom), quotationNo: 'QT-PJ-TEST', revision: 1, createdAt: '2026-09-30T00:00:00Z', createdBy: 'admin-test' };
}

test('quotation rounds each 3 × 0.335 CNY line HALF_UP before summing to 2.02', () => {
  const value = input({ items: [item(), item({ clientLineId: 'line-2' })] });
  const before = structuredClone(value);
  const result = calculateQuotation(value, bom);
  assert.deepEqual(result.items.map(row => row.lineAmount), ['1.01', '1.01']);
  assert.equal(result.totalAmount, '2.02');
  assert.equal(result.currencyScale, 2);
  assert.equal(result.roundingMode, 'HALF_UP');
  assert.equal(result.completeness, 'ready');
  assert.deepEqual(result.validationIssues, []);
  assert.deepEqual(value, before);
  assert.equal('requestKey' in result, false);
  assert.equal('expectedRevision' in result, false);
  assert.equal('expectedQuotationRevision' in result, false);
});

test('null price leaves the quotation incomplete without a misleading partial total; zero is a valid price', () => {
  const missing = saved(input({ items: [item({ unitPrice: null }), item({ clientLineId: 'line-2', unitPrice: '0' })] }));
  assert.deepEqual(missing.items.map(row => row.lineAmount), [null, '0.00']);
  assert.equal(missing.totalAmount, null);
  assert.equal(missing.completeness, 'incomplete');
  assert.deepEqual(missing.validationIssues, ['PRICE_MISSING:line-1']);
  const zero = calculateQuotation(input({ items: [item({ unitPrice: '0.000000' })] }), bom);
  assert.equal(zero.items[0]?.lineAmount, '0.00');
  assert.equal(zero.totalAmount, '0.00');
  assert.equal(zero.completeness, 'ready');
  assert.deepEqual(zero.validationIssues, []);
});

test('JPY uses integer HALF_UP amounts and KWD keeps three decimal places', () => {
  const jpy = calculateQuotation(input({ currency: 'JPY', items: [item({ unitPrice: '0.5' }), item({ clientLineId: 'line-2', unitPrice: '0.5' })] }), bom);
  assert.equal(jpy.currencyScale, 0);
  assert.deepEqual(jpy.items.map(row => row.lineAmount), ['2', '2']);
  assert.equal(jpy.totalAmount, '4');
  const kwd = calculateQuotation(input({ currency: 'KWD', items: [item({ unitPrice: '0.3335' }), item({ clientLineId: 'line-2', unitPrice: '0.3335' })] }), bom);
  assert.equal(kwd.currencyScale, 3);
  assert.deepEqual(kwd.items.map(row => row.lineAmount), ['1.001', '1.001']);
  assert.equal(kwd.totalAmount, '2.002');
  assert.equal(lineAmount('3', '0.335', 3), '1.005');
});

test('decimal arithmetic preserves large exact amounts and rejects malformed or overprecision input', () => {
  assert.equal(decimalUnits('999999999999.999999'), 999999999999999999n);
  assert.equal(lineAmount('999999999999.999999', '1', 2), '1000000000000.00');
  for (const value of ['-1', '1e3', 'NaN', 'Infinity', '01', '.5', '1.', '1.0000001', '1000000000000', '=1+1']) {
    assert.throws(() => decimalUnits(value), { reason: 'QUOTATION_RULE_INVALID', statusCode: 422 }, value);
  }
  assert.throws(() => calculateQuotation(input({ items: [item({ quantity: '0' })] }), bom), { reason: 'QUOTATION_RULE_INVALID' });
});

test('each change from a BOM snapshot requires a nonblank difference reason', () => {
  assert.equal(calculateQuotation(input({ items: [item({ quantity: '3.000' })] }), bom).completeness, 'ready');
  const changes: Partial<QuotationItem>[] = [{ quantity: '4' }, { pricingUnit: '件' }, { name: '替代杆件' }, { model: 'LT-2' }, { specificationMm: '2000' }];
  for (const change of changes) {
    for (const differenceReason of [undefined, '   ']) {
      assert.throws(() => calculateQuotation(input({ items: [item({ ...change, differenceReason })] }), bom), { reason: 'DIFFERENCE_REASON_REQUIRED', statusCode: 422 });
    }
    const result = calculateQuotation(input({ items: [item({ ...change, differenceReason: '客户确认替换' })] }), bom);
    assert.equal(result.completeness, 'ready');
    assert.equal(result.items[0]?.differenceReason, '客户确认替换');
  }
  assert.throws(() => calculateQuotation(input({ items: [item({ bomItemId: undefined })] }), bom), { reason: 'DIFFERENCE_REASON_REQUIRED' });
  assert.equal(calculateQuotation(input({ items: [item({ bomItemId: undefined, differenceReason: '新增物料' })] }), bom).completeness, 'ready');
  assert.throws(() => calculateQuotation(input({ items: [item({ bomItemId: 'unknown', differenceReason: '不应绕过引用校验' })] }), bom), { reason: 'INVALID_BOM_REFERENCE' });
  assert.throws(() => calculateQuotation(input({ items: [item({ kind: 'transport' })] }), bom), { reason: 'INVALID_BOM_REFERENCE' });
});

test('quotation validates identity, currency, dates, time zone and change reason', () => {
  const invalid: Partial<QuotationInput>[] = [
    { currency: 'XYZ' }, { validUntil: '2026-02-30' }, { validityTimeZone: 'Not/A_TimeZone' }, { changeReason: ' ' },
    { items: [item(), item()] }, { items: [item({ clientLineId: '' })] }, { items: [item({ name: ' ' })] },
    { items: [item({ pricingUnit: ' ' })] }, { items: [item({ unitPrice: '-1' })] },
  ];
  for (const overrides of invalid) assert.throws(() => calculateQuotation(input(overrides), bom), { reason: 'QUOTATION_RULE_INVALID', statusCode: 422 });
});

test('incomplete scope and tax terms are actionable while untaxed or not-applicable quotations can be ready', () => {
  const result = calculateQuotation(input({ items: [], inclusions: ' ', exclusions: '', priceBasis: 'excluded', terms: ' ' }), bom);
  assert.equal(result.completeness, 'incomplete');
  assert.deepEqual(result.validationIssues, ['EMPTY_ITEMS', 'INCLUSIONS_REQUIRED', 'EXCLUSIONS_REQUIRED', 'TAX_TERMS_REQUIRED']);
  assert.equal(calculateQuotation(input({ priceBasis: 'excluded', terms: '税费由客户承担' }), bom).completeness, 'ready');
  assert.equal(calculateQuotation(input({ priceBasis: 'not_applicable', terms: '' }), bom).completeness, 'ready');
});

test('quotation expiry follows the validity time zone calendar rather than UTC', () => {
  assert.equal(localCalendarDate('2026-12-31T16:00:00Z', 'Asia/Shanghai'), '2027-01-01');
  assert.equal(localCalendarDate('2027-01-01T00:00:00Z', 'America/Los_Angeles'), '2026-12-31');
});

test('real XLSX round trip preserves CNY, JPY and KWD amounts and quotation metadata as text', async () => {
  for (const [currency, unitPrice, line, total] of [['CNY', '0.335', '1.01', '2.02'], ['JPY', '0.5', '2', '4'], ['KWD', '0.3335', '1.001', '2.002']]) {
    assert.ok(currency && unitPrice && line && total);
    const quotation = saved(input({ currency, items: [item({ unitPrice }), item({ clientLineId: 'line-2', unitPrice })] }));
    const bytes = await quotationWorkbook({ projectNo: 'PJ-TEST', schemeCode: 'SCHEME-1', company: '客户公司', contact: { name: '联系人', email: 'test@example.com', phone: '+8613800000000' } }, quotation);
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('报价单');
    assert.ok(sheet);
    assert.equal(sheet.getCell('B1').value, 'QT-PJ-TEST');
    assert.equal(sheet.getCell('B2').value, '1');
    assert.equal(sheet.getCell('B3').value, 'PJ-TEST');
    assert.equal(sheet.getCell('B4').value, 'SCHEME-1');
    assert.equal(sheet.getCell('B9').value, currency);
    assert.equal(sheet.getCell('B11').value, '2026-12-31');
    assert.equal(sheet.getCell('B12').value, 'Asia/Shanghai');
    assert.equal(sheet.getCell('B13').value, `HALF_UP / ${quotation.currencyScale} 位`);
    assert.equal(sheet.getCell('E16').value, '3');
    assert.equal(sheet.getCell('G16').value, unitPrice);
    assert.equal(sheet.getCell('H16').value, line);
    assert.equal(sheet.getCell('H17').value, line);
    assert.equal(sheet.getCell('B18').value, total);
    assert.equal(sheet.getCell('G16').numFmt, '@');
    assert.equal(sheet.getCell('B18').numFmt, '@');
    sheet.eachRow(row => row.eachCell(cell => assert.notEqual(cell.type, ExcelJS.ValueType.Formula)));
  }
});

test('real XLSX treats formula-like customer and item strings as literal text', async () => {
  const formula = '=HYPERLINK("https://example.com","点击")';
  const quotation = saved(input({ items: [item({ name: formula, model: '+1+1', specificationMm: '-1+1', erpCode: '0000123', notes: '@SUM(A1:A2)', differenceReason: '客户要求名称原样输出' })], terms: formula, inclusions: '+SUM(A1:A2)', exclusions: '@SUM(A1:A2)' }));
  const bytes = await quotationWorkbook({ projectNo: 'PJ-TEXT', schemeCode: null, company: formula, contact: { name: '=1+1' } }, quotation);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet('报价单');
  assert.ok(sheet);
  for (const [address, expected] of [['B5', formula], ['B6', '=1+1'], ['B16', formula], ['C16', '+1+1'], ['D16', '-1+1'], ['I16', '0000123'], ['J16', '@SUM(A1:A2)'], ['B18', '+SUM(A1:A2)'], ['B19', '@SUM(A1:A2)'], ['B20', formula]]) {
    assert.ok(address);
    const cell = sheet.getCell(address);
    assert.equal(cell.value, expected, address);
    assert.equal(cell.type, ExcelJS.ValueType.String, address);
    assert.equal(cell.numFmt, '@', address);
    assert.equal(cell.formula, undefined, address);
  }
});

test('XLSX export rejects missing price or other incomplete quotations', async () => {
  const project = { projectNo: 'PJ-TEST', schemeCode: null, contact: { name: '联系人' } };
  for (const quotation of [saved(input({ items: [item({ unitPrice: null })] })), saved(input({ exclusions: '' }))]) {
    await assert.rejects(quotationWorkbook(project, quotation), { reason: 'QUOTATION_INCOMPLETE', statusCode: 409 });
  }
});
