import { API_BASE_URL, apiFetch } from '@/lib/api-client'

export type Direction = 'front' | 'back' | 'left' | 'right'
export interface ArtworkContext { schemeCode: string; themeJobId: string; resultId: string; selectionRevision: number }
export interface ArtworkOffer { id: string; expiresAt: string; unitCredits: number; maxCredits: number; settlementRule: 'per_usable_direction' }
export interface ArtworkReceipt {
  jobId: string; status: string; deliveryStatus: 'pending' | 'incomplete' | 'ready'; reusedRequest: boolean;
  credits: { status: string; reservedCredits: number; heldCredits: number; chargedCredits: number; releasedCredits: number };
  pollAfterMs: number | null;
}
export interface ArtworkJob extends ArtworkReceipt {
  schemeCode: string; phase: string | null; themeSelection: Omit<ArtworkContext, 'schemeCode'>; referencePreviewUrl: string | null;
  directions: { direction: Direction; status: string; reason: string | null; assetId?: string; width?: number; height?: number; byteSize?: number; filename?: string; previewUrl?: string }[];
  missingDirections: Direction[]; mappingStatus: 'unresolved'; quality: { minLongEdge: number; minShortEdge: number };
}
export interface ArtworkSubmission extends ArtworkContext { requestKey: string; offerId: string }
export async function getArtworkOffer(context: ArtworkContext) {
  return (await apiFetch<{ code: number; data: { offer: ArtworkOffer } }>('/api/v1/client/artwork-offers', { method: 'POST', body: context, retry: 0 })).data.offer
}
export async function createArtworkJob(input: ArtworkSubmission) {
  return (await apiFetch<{ code: number; data: ArtworkReceipt }>('/api/v1/client/artwork-jobs', { method: 'POST', body: input, retry: 0 })).data
}
export async function getArtworkJobs(context: ArtworkContext) {
  return (await apiFetch<{ code: number; data: { items: Pick<ArtworkReceipt, 'jobId' | 'status' | 'deliveryStatus'>[] } }>('/api/v1/client/artwork-jobs', { query: { ...context } })).data.items
}
export async function getArtworkJob(jobId: string) {
  return (await apiFetch<{ code: number; data: ArtworkJob }>(`/api/v1/client/artwork-jobs/${encodeURIComponent(jobId)}`)).data
}
export async function createArtworkJobEventsTicket(jobId: string): Promise<string> {
  return (await apiFetch<{ code: number; data: { ticket: string } }>(`/api/v1/client/artwork-jobs/${encodeURIComponent(jobId)}/events-ticket`, { method: 'POST', retry: 0 })).data.ticket
}
export function openArtworkJobEvents(jobId: string, ticket: string, onUpdate: () => void, onError: () => void): EventSource {
  const events = new EventSource(`${API_BASE_URL.replace(/\/+$/, '')}/api/v1/client/artwork-jobs/${encodeURIComponent(jobId)}/events?ticket=${encodeURIComponent(ticket)}`)
  events.addEventListener('update', onUpdate)
  events.onerror = onError
  return events
}
export async function downloadArtwork(jobId: string, assetId?: string) {
  const suffix = assetId ? `assets/${encodeURIComponent(assetId)}/download` : 'download'
  const response = await apiFetch.raw<Blob, 'blob'>(`/api/v1/client/artwork-jobs/${encodeURIComponent(jobId)}/${suffix}`, { responseType: 'blob', retry: 0, timeout: 120000 })
  const expected = assetId ? 'image/png' : 'application/zip'
  if (!response._data?.size || !response.headers.get('content-type')?.includes(expected)) throw new Error('Invalid artwork download')
  return response._data
}
