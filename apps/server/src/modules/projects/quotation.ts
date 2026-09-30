import { currencyScales, projectError, validDate } from './domain.js';
import type { BomSnapshotItem } from './snapshot.js';

export interface QuotationItem {
  clientLineId: string; kind: 'material' | 'graphic' | 'transport' | 'installation' | 'other'; bomItemId?: string;
  name: string; model?: string; specificationMm?: string; quantity: string; pricingUnit: string; unitPrice: string | null;
  erpCode?: string; notes?: string; differenceReason?: string;
}
export interface QuotationInput {
  requestKey: string; expectedRevision: number; expectedQuotationRevision: number; currency: string;
  priceBasis: 'included' | 'excluded' | 'not_applicable'; validUntil: string; validityTimeZone: string;
  items: QuotationItem[]; terms: string; inclusions: string; exclusions: string; changeReason: string;
}
export interface CalculatedQuotation extends Omit<QuotationInput, 'requestKey' | 'expectedRevision' | 'expectedQuotationRevision'> {
  items: (QuotationItem & { lineAmount: string | null })[]; currencyScale: number; roundingMode: 'HALF_UP';
  totalAmount: string | null; completeness: 'incomplete' | 'ready'; validationIssues: string[];
}
export interface SavedQuotation extends CalculatedQuotation {
  quotationNo: string; revision: number; createdAt: string; createdBy: string;
}
const unit = 1000000n;
export function decimalUnits(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value)) throw projectError('QUOTATION_RULE_INVALID',422);
  const [whole = '0',fraction = ''] = value.split('.');
  return BigInt(whole)*unit + BigInt(fraction.padEnd(6,'0'));
}
function amount(value: bigint, scale: number): string {
  if (!scale) return String(value);
  const divisor = 10n**BigInt(scale);
  return `${value/divisor}.${String(value%divisor).padStart(scale,'0')}`;
}
export function lineAmount(quantity: string, price: string, scale: number): string {
  const product = decimalUnits(quantity)*decimalUnits(price);
  const divisor = 10n**BigInt(12-scale);
  return amount((product+divisor/2n)/divisor,scale);
}
export function calculateQuotation(input: QuotationInput, bom: BomSnapshotItem[]): CalculatedQuotation {
  const scale = currencyScales[input.currency];
  if (scale === undefined || !validDate(input.validUntil) || !input.changeReason.trim() || !['included','excluded','not_applicable'].includes(input.priceBasis)) throw projectError('QUOTATION_RULE_INVALID',422);
  try { new Intl.DateTimeFormat('en-CA',{timeZone:input.validityTimeZone}).format(new Date()); }
  catch { throw projectError('QUOTATION_RULE_INVALID',422); }
  const ids = new Set<string>();
  const originals = new Map(bom.map(item=>[item.id,item]));
  let total = 0n;
  const issues: string[] = [];
  if (!input.items.length) issues.push('EMPTY_ITEMS');
  if (!input.inclusions.trim()) issues.push('INCLUSIONS_REQUIRED');
  if (!input.exclusions.trim()) issues.push('EXCLUSIONS_REQUIRED');
  if (input.priceBasis === 'excluded' && !input.terms.trim()) issues.push('TAX_TERMS_REQUIRED');
  const items = input.items.map(item => {
    if (!item.clientLineId || ids.has(item.clientLineId) || !item.name.trim() || !item.pricingUnit.trim() || decimalUnits(item.quantity)<=0n
      || !['material','graphic','transport','installation','other'].includes(item.kind)) throw projectError('QUOTATION_RULE_INVALID',422);
    ids.add(item.clientLineId);
    if (item.bomItemId) {
      const original = originals.get(item.bomItemId);
      if (!original || item.kind !== 'material') throw projectError('INVALID_BOM_REFERENCE',422);
      if ((decimalUnits(item.quantity)!==decimalUnits(original.quantity) || item.pricingUnit!==original.pricingUnit || item.name!==original.productName
        || (item.model ?? '')!==(original.productModel ?? '') || (item.specificationMm ?? '')!==(original.specificationMm ?? '')) && !item.differenceReason?.trim()) throw projectError('DIFFERENCE_REASON_REQUIRED',422);
    } else if (item.kind==='material' && !item.differenceReason?.trim()) throw projectError('DIFFERENCE_REASON_REQUIRED',422);
    const value = item.unitPrice === null ? null : lineAmount(item.quantity,item.unitPrice,scale);
    if (value === null) issues.push(`PRICE_MISSING:${item.clientLineId}`);
    else total += BigInt(value.replace('.',''));
    return {...item,lineAmount:value};
  });
  const {requestKey: _key,expectedRevision: _project,expectedQuotationRevision: _quote,...body} = input;
  return {...body,items,currencyScale:scale,roundingMode:'HALF_UP',totalAmount:items.some(item=>item.lineAmount===null)?null:amount(total,scale),
    completeness:issues.length?'incomplete':'ready',validationIssues:issues};
}
export function localCalendarDate(timestamp: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(item=>item.type===type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
