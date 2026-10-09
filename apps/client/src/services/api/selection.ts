import { API_BASE_URL, apiFetch } from '@/lib/api-client'
import type { MatchResponse, ParseResponse, Requirement, SchemeImage } from '@/features/selection/types'

export interface ParseRequirementInput {
  attemptId: string
  text: string
  form: Requirement
}

export interface MatchSchemesInput {
  attemptId: string
  parseId?: string
  mode: 'random' | 'filtered'
  requirement: Requirement
  inputContext: { textProvided: boolean; text: string; degradedParse: boolean }
}

function unwrap<T>(response: { code: number; data: T }, name: string) {
  if (response.code !== 0) throw new Error(`${name} unavailable`)
  return response.data
}

export async function parseRequirement(body: ParseRequirementInput): Promise<ParseResponse> {
  return unwrap(await apiFetch<{ code: number; data: ParseResponse }>('/api/v1/client/requirements/parse', { method: 'POST', body }), 'Parse')
}

export async function matchSchemes(body: MatchSchemesInput): Promise<MatchResponse> {
  return unwrap(await apiFetch<{ code: number; data: MatchResponse }>('/api/v1/client/scheme-matches', { method: 'POST', body }), 'Match')
}

/** 取方案当前的图片链接（presigned URL 会过期，智选结果用它按 assetId 换新链接） */
export async function getSchemeImages(code: string): Promise<SchemeImage[]> {
  const data = unwrap(await apiFetch<{ code: number; data: { images: SchemeImage[] } }>(`/api/v1/client/schemes/${encodeURIComponent(code)}`), 'Scheme')
  if (!Array.isArray(data.images)) throw new Error('Scheme images unavailable')
  return data.images
}

/** 方案封面的固定地址：服务端每次 302 到新的短时签名地址，可长期放在 <img> 中（如客服会话里的方案卡片） */
export function schemeCoverUrl(code: string) {
  return `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/client/schemes/${encodeURIComponent(code)}/cover`
}
