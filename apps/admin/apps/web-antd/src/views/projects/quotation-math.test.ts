import { describe, expect, it } from 'vitest';

import {
  isDecimal,
  isQuantity,
  lineAmount,
  quotationTotal,
} from './quotation-math';

// 用例与服务端 tests/unit/quotation.test.ts 保持一致
describe('quotation math', () => {
  it('rounds each line HALF_UP to the currency scale like the server', () => {
    expect(lineAmount('3', '0.335', 2)).toBe('1.01');
    expect(lineAmount('3', '0.335', 3)).toBe('1.005');
    expect(lineAmount('1', '0', 2)).toBe('0.00');
    expect(lineAmount('3', '0.5', 0)).toBe('2');
    expect(lineAmount('3', '0.3335', 3)).toBe('1.001');
    expect(lineAmount('999999999999.999999', '1', 2)).toBe('1000000000000.00');
  });

  it('sums lines exactly and refuses a partial total', () => {
    expect(quotationTotal(['1.01', '1.01'], 2)).toBe('2.02');
    expect(quotationTotal(['2', '2'], 0)).toBe('4');
    expect(quotationTotal(['1.001', '1.001'], 3)).toBe('2.002');
    expect(quotationTotal(['1.01', null], 2)).toBeNull();
    expect(quotationTotal([], 2)).toBeNull();
  });

  it('rejects malformed, over-precision or non-positive input', () => {
    for (const value of [
      '-1',
      '1e3',
      'NaN',
      'Infinity',
      '01',
      '.5',
      '1.',
      '1.0000001',
      '1000000000000',
      '=1+1',
      '',
      null,
    ])
      expect(isDecimal(value)).toBe(false);
    expect(isQuantity('0')).toBe(false);
    expect(isQuantity('0.000')).toBe(false);
    expect(isQuantity('0.5')).toBe(true);
    expect(lineAmount('0', '1', 2)).toBeNull();
    expect(lineAmount('1', null, 2)).toBeNull();
    expect(lineAmount('1', '1.0000001', 2)).toBeNull();
  });
});
