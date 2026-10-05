import { apiFetch } from '@/lib/api-client'

import type { QuoteRequest } from './quote-requests'

export type { ProjectReceipt } from './quote-requests'
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
