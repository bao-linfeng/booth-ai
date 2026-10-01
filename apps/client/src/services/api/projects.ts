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
export interface ManualRequest extends Omit<QuoteRequest,'schemeCode'|'schemeRevision'|'bomRevision'|'drawingRevision'|'artworkRevision'|'artworkJobId'|'themeSelection'|'requirementContext'|'entryPoint'> {
  entryPoint: 'matching_results'; originalDescription: string; confirmedRequirements: Requirement; parsedRequirements?: Requirement; unresolvedQuestions?: string[];
}
export async function submitManualRequest(input: ManualRequest) {
  return (await apiFetch<{ code: number; data: ProjectReceipt }>('/api/v1/client/manual-requests', { method: 'POST', body: input, retry: 0 })).data
}
export async function getQuoteContext(code: string) {
  return (await apiFetch<{ code: number; data: QuoteContext }>(`/api/v1/client/schemes/${encodeURIComponent(code)}/quote-context`)).data
}
export async function submitQuote(input: QuoteRequest) {
  return (await apiFetch<{ code: number; data: ProjectReceipt }>('/api/v1/client/quote-requests', { method: 'POST', body: input, retry: 0 })).data
}
export type ProjectStatus = 'pending' | 'following' | 'quoted' | 'won' | 'lost' | 'closed'
export const statusLabels: Record<ProjectStatus,string> = { pending:'待跟进', following:'跟进中', quoted:'已报价', won:'已成交', lost:'未成交', closed:'已关闭' }
export interface MyProject {
  projectId: string; projectNo: string; schemeCode: string | null; sourceType: 'quote_request' | 'manual_request'; status: ProjectStatus;
  exhibition: QuoteRequest['exhibition'] | null; createdAt: string; updatedAt: string
}
export interface MyProjectDetail extends Omit<MyProject,'exhibition'> {
  revision: number; artworkJobId: string | null;
  requestNo: string;
  request: { exhibition: QuoteRequest['exhibition'] | null; contact: { name: string; email?: string; phone?: string; legacyDetail?: string }; company?: string;
    scopeCodes: string[]; scopeNotes?: string; notes?: string; materialBudget: QuoteRequest['materialBudget'] | null; originalDescription?: string;
    confirmedRequirements?: Record<string,unknown>; unresolvedQuestions: string[]; legacyIncomplete: boolean };
  schemeSnapshot: { code: string; name: string; revision: number; lengthMm: number; widthMm: number; heightMm: number; openingCount: number } | null;
  materialsStatus: { bom: string; drawings: string; artworks: string }; selectedThemeSummary: { themeJobId: string; resultId: string; selectionRevision: number; previewUrl: string } | null;
  publicResult: string | null
}
export interface ProjectPage { items: MyProject[]; total: number; page: number; pageSize: number }
export async function getMyProjects(query: { page: number; pageSize: number; projectNo?: string; status?: string; sourceType?: string; exhibitionName?: string }) {
  const params = new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined && value!=='').map(([key,value])=>[key,String(value)]))
  return (await apiFetch<{code:number;data:ProjectPage}>(`/api/v1/client/me/projects?${params}`)).data
}
export async function getMyProject(id: string) {
  return (await apiFetch<{code:number;data:MyProjectDetail}>(`/api/v1/client/me/projects/${encodeURIComponent(id)}`)).data
}
export async function bindProjectArtworks(id: string, input: { artworkJobId: string; requestKey: string; expectedRevision: number }) {
  return (await apiFetch<{ code: number; data: { projectId: string; revision: number; artworkJobId: string; status: string } }>(`/api/v1/client/me/projects/${encodeURIComponent(id)}/artworks`, { method: 'PUT', body: input, retry: 0 })).data
}
