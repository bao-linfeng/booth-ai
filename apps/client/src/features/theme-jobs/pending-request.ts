import type { ThemeJobSubmission, ThemeOffer } from '@/services/api/theme-jobs'

/**
 * 已发出但结果未确认的换主题提交（sessionStorage）。刷新或离开后回到同一方案，先用原请求键重放，
 * 服务端已创建时直接拿回原任务，不会再新建任务或预占积分；只有服务端明确受理或拒绝后才删除。
 */
export interface PendingThemeRequest {
  payload: ThemeJobSubmission
  quote: NonNullable<ThemeOffer['offer']>
}

export function pendingThemeRequestKey(userId: string, schemeCode: string, searchId: string | undefined) {
  return `booth:theme-request:${userId}:${schemeCode}:${searchId ?? ''}`
}

function isPendingThemeRequest(value: unknown, schemeCode: string, searchId: string | undefined): value is PendingThemeRequest {
  if (typeof value !== 'object' || value === null) return false
  const { payload, quote } = value as Record<string, Record<string, unknown> | undefined>
  const input = payload?.input as Record<string, unknown> | undefined
  return !!payload && !!quote && !!input &&
    typeof payload.requestKey === 'string' && typeof payload.offerId === 'string' &&
    payload.schemeCode === schemeCode && (payload.searchId ?? undefined) === searchId &&
    typeof payload.sourceAssetId === 'string' && typeof payload.requestedCount === 'number' &&
    typeof input.industryId === 'string' && typeof input.styleId === 'string' && typeof input.brandKeywords === 'string' &&
    Array.isArray(input.brandColors) && input.brandColors.every(color => typeof color === 'string') &&
    typeof quote.id === 'string' && typeof quote.expiresAt === 'string' && typeof quote.maxCredits === 'number' && typeof quote.unitCredits === 'number'
}

export function readPendingThemeRequest(key: string, schemeCode: string, searchId: string | undefined): PendingThemeRequest | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (isPendingThemeRequest(value, schemeCode, searchId)) return value
    sessionStorage.removeItem(key)
  } catch { /* 存储不可用或内容损坏时按无待确认提交处理 */ }
  return null
}

/** 写入失败（存储被禁用或配额已满）不阻止提交：同一页面内重试仍复用内存中的请求键，只是刷新后无法恢复 */
export function writePendingThemeRequest(key: string, value: PendingThemeRequest) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { return }
}

export function clearPendingThemeRequest(key: string) {
  try { sessionStorage.removeItem(key) } catch { return }
}
