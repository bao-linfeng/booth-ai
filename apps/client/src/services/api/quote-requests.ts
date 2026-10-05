import { apiFetch } from '@/lib/api-client'
import type { Requirement } from '@/features/selection/types'

export interface QuoteContext {
  schemeCode: string; schemeRevision: number; bomRevision: number | null; drawingRevision: number | null; artworkRevision: number | null;
  materialsStatus: { bom: string; drawings: string; artworks: string }
}
export interface QuoteRequest {
  requestKey: string; schemeCode: string; schemeRevision: number; bomRevision?: number; drawingRevision?: number; artworkRevision?: number;
  themeSelection?: { themeJobId: string; resultId: string; selectionRevision: number };
  artworkJobId?: string;
  entryPoint: 'scheme_detail' | 'bill_of_materials' | 'theme_result';
  exhibition: { name: string; countryCode: string; city: string; startDate: string; endDate: string };
  scopeCodes: string[]; scopeNotes: string; materialBudget: { currency: string; amount: string };
  customerType: 'individual' | 'company'; company: string; contact: { name: string; email?: string; phone?: string }; notes: string;
  requirementContext?: { originalDescription: string; confirmedRequirements: Requirement };
}
export interface ProjectReceipt {
  quoteRequestId?: string; manualRequestId?: string; requestNo: string; projectId: string; projectNo: string; status: string; revision: number;
  schemeCode: string | null; bomRevision?: number | null; drawingRevision?: number | null; materialsStatus?: QuoteContext['materialsStatus']; createdAt: string;
}

export async function getQuoteContext(code: string): Promise<QuoteContext> {
  return (await apiFetch<{ code: number; data: QuoteContext }>(`/api/v1/client/schemes/${encodeURIComponent(code)}/quote-context`)).data
}

export async function submitQuote(input: QuoteRequest): Promise<ProjectReceipt> {
  return (await apiFetch<{ code: number; data: ProjectReceipt }>('/api/v1/client/quote-requests', { method: 'POST', body: input, retry: 0 })).data
}
