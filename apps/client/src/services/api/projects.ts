import { apiFetch } from '@/lib/api-client'

import type { QuoteRequest } from './quote-requests'

export type { ProjectReceipt } from './quote-requests'
export type ProjectStatus = 'pending' | 'following' | 'quoted' | 'won' | 'lost' | 'closed'
export interface MyProject {
  projectId: string; projectNo: string; schemeCode: string | null; sourceType: 'quote_request' | 'manual_request'; status: ProjectStatus;
  exhibition: QuoteRequest['exhibition'] | null; createdAt: string; progressUpdatedAt: string
}
/** 客户可见进度节点，由服务端按项目事件推导 */
export type ProgressStep = 'submitted' | 'advisor_assigned' | 'advisor_changed' | 'following' | 'quote_sent' | 'won' | 'lost' | 'closed' | 'reopened'
export interface ProjectProgress {
  /** 客户可见内容最近一次变化的时间，内部操作不计入 */
  updatedAt: string
  note: { content: string; publishedAt: string } | null
  /** 按时间正序 */
  timeline: { step: ProgressStep; at: string }[]
}
export interface MyProjectDetail extends Omit<MyProject,'exhibition'|'progressUpdatedAt'> {
  revision: number; artworkJobId: string | null;
  requestNo: string;
  request: { exhibition: QuoteRequest['exhibition'] | null; contact: { name: string; email?: string; phone?: string; legacyDetail?: string }; company?: string;
    scopeCodes: string[]; scopeNotes?: string; notes?: string; materialBudget: QuoteRequest['materialBudget'] | null; originalDescription?: string;
    confirmedRequirements?: Record<string,unknown>; unresolvedQuestions: string[]; legacyIncomplete: boolean };
  schemeSnapshot: { code: string; name: string; revision: number; lengthMm: number; widthMm: number; heightMm: number; openingCount: number } | null;
  materialsStatus: { bom: string; drawings: string; artworks: string }; selectedThemeSummary: { themeJobId: string; resultId: string; selectionRevision: number; previewUrl: string } | null;
  progress: ProjectProgress
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
