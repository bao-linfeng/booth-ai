import type { MatchItem, Requirement } from './types'
import { isRecord, isRequirement, isStringArray, readSelectionSession, selectionSnapshot } from './session'

// 智选页 → 报价页 / 人工需求页的交接数据。写入方只有 AISelection，读取方只有 QuoteRequest；结构变更只改这里。
const manualContextKey = 'booth:manual-context'
/** 人工需求页的表单草稿；由 QuoteRequest 维护，智选页只在没有进行中的提交时预填联系人 */
export const manualDraftKey = 'booth:manual-draft'

export interface SelectionQuoteHandoff {
  requirementContext: { originalDescription: string; confirmedRequirements: Requirement }
  matchingSummary: Pick<MatchItem, 'matchType' | 'differences' | 'pendingConfirmations'>
}

export interface ManualHandoff {
  originalDescription: string
  confirmedRequirements: Requirement
  unresolvedQuestions: string[]
}

export interface ManualContact {
  owner: string | null
  name: string
  /** 手机号或邮箱，含 @ 视为邮箱 */
  contact: string
}

/**
 * 报价交接：仅当当前智选会话是“已出结果且条件未改动”的按条件匹配，且目标方案在本次结果内时才返回。
 * 传入 searchId（来自详情页链路）时还必须与会话中的检索一致，避免历史检索或其他会话的条件被关联到方案。
 */
export function readSelectionQuoteHandoff(schemeCode: string, searchId?: string): SelectionQuoteHandoff | null {
  const session = readSelectionSession()
  const match = session?.liveMatchData
  if (!session || !match || session.state !== 'results' || match.status !== 'matched' || match.mode !== 'filtered') return null
  if (session.snapshot !== selectionSnapshot(session.requirement, session.text)) return null
  if (searchId !== undefined && session.searchId !== searchId) return null
  const item = match.items.find(candidate => candidate.code === schemeCode)
  if (!item) return null
  return {
    requirementContext: { originalDescription: session.text, confirmedRequirements: session.requirement },
    matchingSummary: { matchType: item.matchType, differences: item.differences, pendingConfirmations: item.pendingConfirmations },
  }
}

// 草稿里已有待确认或已完成的人工申请时不能覆盖，否则会丢失幂等键或回执
function hasManualSubmission() {
  try {
    const draft: unknown = JSON.parse(sessionStorage.getItem(manualDraftKey) ?? 'null')
    return isRecord(draft) && (!!draft.pendingManual || !!draft.receipt)
  } catch {
    sessionStorage.removeItem(manualDraftKey)
    return false
  }
}

export function writeManualHandoff(context: ManualHandoff, contact: ManualContact) {
  try {
    sessionStorage.setItem(manualContextKey, JSON.stringify(context))
    if (hasManualSubmission()) return
    const channel = contact.contact.includes('@') ? { email: contact.contact } : { phone: contact.contact }
    sessionStorage.setItem(manualDraftKey, JSON.stringify({ owner: contact.owner, pending: null, pendingManual: null, form: { contactName: contact.name, ...channel } }))
  } catch { return }
}

export function readManualHandoff(): ManualHandoff | null {
  try {
    const raw = sessionStorage.getItem(manualContextKey)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (isRecord(value) && typeof value.originalDescription === 'string' && isRequirement(value.confirmedRequirements) && isStringArray(value.unresolvedQuestions)) {
      return { originalDescription: value.originalDescription, confirmedRequirements: value.confirmedRequirements, unresolvedQuestions: value.unresolvedQuestions }
    }
  } catch { /* 解析失败按无效数据清除 */ }
  try { sessionStorage.removeItem(manualContextKey) } catch { return null }
  return null
}
