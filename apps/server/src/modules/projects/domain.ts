import { createHash } from 'node:crypto';
import type { Requirement } from '../client/selection/domain.js';

export const currencyScales: Record<string, number> = { CNY: 2, USD: 2, EUR: 2, GBP: 2, HKD: 2, JPY: 0, KRW: 0, KWD: 3 };
export const scopeCodes = ['materials', 'graphics', 'transport', 'installation', 'other'];
export interface QuoteInput {
  requestKey: string;
  schemeCode: string;
  schemeRevision?: number;
  bomRevision?: number;
  drawingRevision?: number;
  artworkRevision?: number;
  themeSelection?: { themeJobId: string; resultId: string; selectionRevision: number };
  entryPoint: 'scheme_detail' | 'bill_of_materials' | 'theme_result' | 'matching_results' | 'su';
  exhibition: { name: string; countryCode: string; city: string; startDate: string; endDate: string };
  scopeCodes: string[];
  scopeNotes?: string;
  materialBudget: { currency: string; amount: string };
  customerType: 'individual' | 'company';
  company?: string;
  contact: { name: string; email?: string; phone?: string };
  notes?: string;
  requirementContext?: { originalDescription: string; confirmedRequirements: Requirement };
}
export interface Receipt {
  quoteRequestId: string; requestNo: string; projectId: string; projectNo: string; status: string;
  revision: number; schemeCode: string; bomRevision: number | null; drawingRevision: number | null;
  materialsStatus: { bom: string; drawings: string; artworks: string }; createdAt: string;
}
export interface ManualInput extends Omit<QuoteInput, 'schemeCode' | 'schemeRevision' | 'bomRevision' | 'drawingRevision' | 'artworkRevision' | 'themeSelection' | 'requirementContext'> {
  originalDescription: string; parsedRequirements?: Requirement; confirmedRequirements: Requirement; unresolvedQuestions?: string[];
}
export type ProjectStatus = 'pending' | 'following' | 'quoted' | 'won' | 'lost' | 'closed';
export const terminalStatuses: ProjectStatus[] = ['won','lost','closed'];
export function normalizeManual(input: ManualInput): ManualInput {
  const quote = normalizeQuote({...input,schemeCode:'manual'});
  const {schemeCode: _scheme,...normalized} = quote;
  if (!input.originalDescription.trim()) throw projectError('INVALID_INPUT',400);
  return {...normalized,originalDescription:input.originalDescription.trim(),confirmedRequirements:input.confirmedRequirements,
    ...(input.parsedRequirements ? {parsedRequirements:input.parsedRequirements}:{}),unresolvedQuestions:input.unresolvedQuestions ?? []};
}
export function projectError(reason: string, statusCode = 409) { return Object.assign(new Error(reason), { statusCode, reason }); }
export function digest(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical) : input && typeof input === 'object'
    ? Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : input;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function normalizeQuote(input: QuoteInput): QuoteInput {
  const exhibition = { ...input.exhibition, name: input.exhibition.name.trim(), city: input.exhibition.city.trim() };
  const contact = { name: input.contact.name.trim(), ...(input.contact.email?.trim() ? { email: input.contact.email.trim() } : {}), ...(input.contact.phone?.trim() ? { phone: input.contact.phone.trim() } : {}) };
  const company = input.company?.trim() ?? '';
  if (!input.schemeCode.trim() || !exhibition.name || !exhibition.city || !validDate(exhibition.startDate) || !validDate(exhibition.endDate) || exhibition.endDate < exhibition.startDate
    || !/^[A-Z]{2}$/.test(exhibition.countryCode) || !contact.name || (!contact.email && !contact.phone)
    || (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))
    || (contact.phone && (!/^\+?[\d ()-]{7,30}$/.test(contact.phone) || !/^\d{7,15}$/.test(contact.phone.replace(/\D/g,''))))
    || (input.customerType === 'company' && !company) || !input.scopeCodes.length || input.scopeCodes.some(code => !scopeCodes.includes(code))
    || (input.scopeCodes.includes('other') && !input.scopeNotes?.trim()) || !(input.materialBudget.currency in currencyScales)
    || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(input.materialBudget.amount) || !/[1-9]/.test(input.materialBudget.amount)) throw projectError('INVALID_INPUT', 400);
  const [whole, fraction = ''] = input.materialBudget.amount.split('.');
  const decimals = fraction.replace(/0+$/, '');
  return { ...input, schemeCode: input.schemeCode.trim(), exhibition, contact, company, scopeCodes: [...new Set(input.scopeCodes)].sort(),
    scopeNotes: input.scopeNotes?.trim() ?? '', notes: input.notes?.trim() ?? '', materialBudget: { ...input.materialBudget, amount: decimals ? `${whole}.${decimals}` : whole! } };
}
