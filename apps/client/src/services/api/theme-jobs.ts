import { API_BASE_URL, apiFetch } from '@/lib/api-client'

export interface ThemeOffer {
  available: boolean
  blockedReasons: string[]
  limits: {
    maxBrandColors: number
    maxKeywordCharacters: number
    allowedCounts: number[]
  }
  supportedCombinations: Array<{ industryId: string; styleId: string }>
  offer: {
    id: string
    expiresAt: string
    pricingRevision: number
    unitCredits: number
    maxCredits: number
    settlementRule: string
    cacheHit: boolean
  } | null
}

export interface ThemeJobInput {
  industryId: string
  styleId: string
  brandColors: string[]
  brandKeywords: string
}

export interface ThemeJobResult {
  resultId: string
  previewUrl: string
  width: number
  height: number
}

export interface ThemeJob {
  jobId: string
  schemeCode: string
  searchId: string | null
  status: 'pending' | 'queued' | 'running' | 'settling' | 'succeeded' | 'partially_succeeded' | 'failed'
  phase: string | null
  requestedCount: number
  usableCount: number
  original: { assetId: string; previewUrl: string }
  results: ThemeJobResult[]
  selection: { resultId: string | null; revision: number }
  credits: {
    status: 'pending' | 'reserved' | 'settling' | 'settled' | 'released' | 'not_charged'
    reservedCredits: number
    chargedCredits: number
    releasedCredits: number
  }
  failure: { reason: string; retryable: boolean } | null
  pollAfterMs: number | null
}

export async function getThemeOffer(
  schemeCode: string,
  sourceAssetId: string,
  input?: ThemeJobInput,
  requestedCount?: number,
  searchId?: string
): Promise<ThemeOffer> {
  const res = await apiFetch<{ code: number; data: ThemeOffer }>(
    '/api/v1/client/theme-offers',
    {
      method: 'POST',
      body: {
        schemeCode,
        sourceAssetId,
        ...(input ? { input } : {}),
        ...(requestedCount ? { requestedCount } : {}),
        cacheMode: 'reuse',
        ...(searchId ? { searchId } : {}),
      },
    }
  )
  return res.data
}

export async function createThemeJob(payload: {
  requestKey: string
  offerId: string
  schemeCode: string
  sourceAssetId: string
  input: ThemeJobInput
  requestedCount: number
  cacheMode: 'reuse' | 'refresh'
  searchId?: string
}): Promise<{ jobId: string; status: string; pollAfterMs: number }> {
  const res = await apiFetch<{ code: number; data: { jobId: string; status: string; pollAfterMs: number } }>(
    '/api/v1/client/theme-jobs',
    { method: 'POST', body: payload }
  )
  return res.data
}

export async function getThemeJob(jobId: string): Promise<ThemeJob> {
  const res = await apiFetch<{ code: number; data: ThemeJob }>(
    `/api/v1/client/theme-jobs/${encodeURIComponent(jobId)}`
  )
  return res.data
}

export async function createThemeJobEventsTicket(jobId: string): Promise<string> {
  const res = await apiFetch<{ code: number; data: { ticket: string } }>(
    `/api/v1/client/theme-jobs/${encodeURIComponent(jobId)}/events-ticket`,
    { method: 'POST' }
  )
  return res.data.ticket
}

export function openThemeJobEvents(jobId: string, ticket: string, onUpdate: () => void, onError: () => void): EventSource {
  const events = new EventSource(
    `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/client/theme-jobs/${encodeURIComponent(jobId)}/events?ticket=${encodeURIComponent(ticket)}`
  )
  events.addEventListener('update', onUpdate)
  events.onerror = onError
  return events
}

export async function saveThemeSelection(
  jobId: string,
  resultId: string,
  expectedRevision: number
): Promise<{ jobId: string; schemeCode: string; resultId: string; revision: number; selectedAt: string }> {
  const res = await apiFetch<{ code: number; data: { jobId: string; schemeCode: string; resultId: string; revision: number; selectedAt: string } }>(
    `/api/v1/client/theme-jobs/${encodeURIComponent(jobId)}/selection`,
    { method: 'PUT', body: { resultId, expectedRevision } }
  )
  return res.data
}
