// 与服务端 modules/projects/quotation.ts 的 lineAmount 相同：数量、单价各保留 6 位小数，乘积按币种小数位 HALF_UP 舍入。
// 只用于编辑时实时显示，保存后仍以服务端结果为准。

/** 数量与单价的格式（与服务端校验同一正则）：最多 12 位整数、6 位小数，不允许前导零 */
export const decimalPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

export const currencyScales: Record<string, number> = {
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
};

const unit = 1_000_000n;

function decimalUnits(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * unit + BigInt(fraction.padEnd(6, '0'));
}

function formatAmount(value: bigint, scale: number): string {
  if (!scale) return String(value);
  const divisor = 10n ** BigInt(scale);
  return `${value / divisor}.${String(value % divisor).padStart(scale, '0')}`;
}

export function isDecimal(value: unknown): value is string {
  return typeof value === 'string' && decimalPattern.test(value);
}

/** 数量需为大于 0 的合法小数 */
export function isQuantity(value: unknown): value is string {
  return isDecimal(value) && /[1-9]/.test(value);
}

/** 行金额；单价为空、数量或单价格式不合法时返回 null */
export function lineAmount(
  quantity: unknown,
  unitPrice: unknown,
  scale: number,
): null | string {
  if (!isQuantity(quantity) || !isDecimal(unitPrice)) return null;
  const product = decimalUnits(quantity) * decimalUnits(unitPrice);
  const divisor = 10n ** BigInt(12 - scale);
  return formatAmount((product + divisor / 2n) / divisor, scale);
}

/** 合计；任一行金额为空时返回 null，不把部分合计当作总价 */
export function quotationTotal(
  amounts: (null | string)[],
  scale: number,
): null | string {
  if (amounts.length === 0 || amounts.includes(null)) return null;
  const total = amounts.reduce(
    (sum, amount) => sum + BigInt((amount as string).replace('.', '')),
    0n,
  );
  return formatAmount(total, scale);
}
