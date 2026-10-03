import { bomError } from './errors.js';
import type { BomItemInput, MeasurementKind } from './types.js';

const SCALE = 1000000n;
const QUANTITY_LIMIT = 1000000000000000000n;
const MAX_ITEMS = 10000;
const ALLOWED_UNITS: Record<MeasurementKind, readonly string[]> = {
  count: ['个', '件'],
  length: ['mm', 'm'],
  area: ['mm2', 'mm²', 'm2', 'm²'],
};

function defaultUnit(kind: MeasurementKind): string {
  return kind === 'count' ? '件' : kind === 'length' ? 'mm' : 'mm²';
}

function unitDivisor(sourceUnit: string): bigint {
  if (sourceUnit === 'mm') return 1000n;
  if (sourceUnit === 'mm2' || sourceUnit === 'mm²') return 1000000n;
  return 1n;
}

export function canonicalDecimal(value: string): string {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value)) throw bomError('INVALID_QUANTITY', 400);
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole!;
}

/** 按计量类型与来源单位把来源数量换算为标准数量（件 / m / m²）；不能整除或越界时抛错。 */
export function quantityFor(value: string, kind: MeasurementKind, sourceUnit = defaultUnit(kind)): string {
  const normalized = canonicalDecimal(value);
  if (normalized === '0') throw bomError('INVALID_QUANTITY', 400);
  const [whole = '0', fraction = ''] = normalized.split('.');
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
  if (!ALLOWED_UNITS[kind].includes(sourceUnit)) throw bomError('INVALID_INPUT', 400);
  const divisor = unitDivisor(sourceUnit);
  if (scaled % divisor !== 0n) throw bomError('INVALID_QUANTITY', 400);
  const result = scaled / divisor;
  if (result <= 0n || result >= QUANTITY_LIMIT) throw bomError('INVALID_QUANTITY', 400);
  return canonicalDecimal(`${result / SCALE}.${String(result % SCALE).padStart(6, '0')}`);
}

export function validateItems(items: BomItemInput[]): void {
  if (!items.length || items.length > MAX_ITEMS) throw bomError('INVALID_INPUT', 400);
  for (const item of items) {
    if (!['count', 'length', 'area'].includes(item.measurementKind) || !item.productName.trim() || !item.sourceUnit.trim()) {
      throw bomError('INVALID_INPUT', 400);
    }
    const normalized = canonicalDecimal(item.sourceQuantity);
    if (item.measurementKind === 'count' && normalized.includes('.')) throw bomError('INVALID_QUANTITY', 400);
    quantityFor(item.sourceQuantity, item.measurementKind, item.sourceUnit);
    for (const value of [item.unitPrice, item.totalPrice, item.totalWeightKg]) {
      if (value != null) canonicalDecimal(value);
    }
  }
}
