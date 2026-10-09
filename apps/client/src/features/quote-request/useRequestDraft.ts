import { reactive, ref, watch } from 'vue'
import type { ProjectReceipt, QuoteRequest } from '@/services/api/quote-requests'
import type { ManualRequest } from '@/services/api/manual-requests'
import type { CurrentUser } from '@/services/types/user.type'
import type { ManualHandoff } from '@/features/selection/handoff'
import { isRecord, isRequirement, isStringArray } from '@/features/selection/session'
import { emptyRequirement, type Requirement } from '@/features/selection/types'
import { createRequestForm, type RequestForm } from './form'

interface StoredDraft {
  form: Record<string, unknown>; pending: QuoteRequest | null; pendingManual?: ManualRequest | null
  originalDescription?: string; confirmedRequirements?: Requirement; unresolvedQuestions?: string[]
  receipt?: ProjectReceipt | null; owner: string | null
}

/** 报价草稿按方案与主题/素材任务区分，同一方案不同主题的填写互不覆盖 */
export function quoteDraftKey(code: string, themeJobId: unknown, artworkJobId: unknown) {
  return `booth:quote-draft:${code}:${String(themeJobId ?? 'standard')}:${String(artworkJobId ?? 'pending')}`
}

const isSubmission = (value: unknown) => value === null || value === undefined || (isRecord(value) && typeof value.requestKey === 'string')

function isStoredDraft(value: unknown): value is StoredDraft {
  return isRecord(value) && (value.owner === null || typeof value.owner === 'string') && isRecord(value.form)
    && isSubmission(value.pending) && isSubmission(value.pendingManual)
    && (value.receipt === null || value.receipt === undefined || (isRecord(value.receipt) && typeof value.receipt.projectId === 'string' && typeof value.receipt.projectNo === 'string'))
    && (value.originalDescription === undefined || typeof value.originalDescription === 'string')
    && (value.confirmedRequirements === undefined || isRequirement(value.confirmedRequirements))
    && (value.unresolvedQuestions === undefined || isStringArray(value.unresolvedQuestions))
}

function removeStoredDraft(key: string) {
  try { sessionStorage.removeItem(key) } catch { return }
}

/** 存储不可用、内容损坏或结构不符时按无草稿处理，并尽量清除坏数据 */
function readStoredDraft(key: string): StoredDraft | null {
  let raw: string | null
  try { raw = sessionStorage.getItem(key) } catch { return null }
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (isStoredDraft(value)) return value
  } catch { /* 内容损坏 */ }
  removeStoredDraft(key)
  return null
}

/** 只采纳已知字段且类型正确的值 */
function restoreForm(form: RequestForm, saved: Record<string, unknown>) {
  for (const key of Object.keys(form) as (keyof RequestForm)[]) {
    const value = saved[key]
    if (key === 'scopeCodes') { if (isStringArray(value)) form.scopeCodes = [...value] }
    else if (key === 'customerType') { if (value === 'company' || value === 'individual') form.customerType = value }
    else if (typeof value === 'string') (form as unknown as Record<string, string>)[key] = value
  }
}

/**
 * 申请页草稿：表单、待确认提交（含幂等键）与回执写入 sessionStorage，登录跳转或刷新后恢复。
 * 草稿记录归属账号，只恢复同一账号的草稿；匿名草稿在没有进行中提交或回执时可被任何账号接手。
 * 匿名提交结果未确认时登录，服务端按不同身份去重，不能以登录身份重发：不恢复其内容（邮箱可能不属于当前账号），
 * 只通过 unconfirmedGuestSubmission 提示用户先到“我的项目”查看是否已受理，避免重复申请。
 * 存储不可用时草稿只保存在内存中，persist 返回 false。
 */
export function useRequestDraft(key: string, user: CurrentUser | null, manualHandoff: ManualHandoff | null) {
  const form = reactive(createRequestForm(user))
  const pending = ref<QuoteRequest | null>(null)
  const pendingManual = ref<ManualRequest | null>(null)
  const receipt = ref<ProjectReceipt | null>(null)
  const owner = ref(user?.id ?? null)
  const originalDescription = ref(manualHandoff?.originalDescription ?? '')
  const confirmedRequirements = ref(manualHandoff?.confirmedRequirements ?? emptyRequirement())
  const unresolvedQuestions = ref(manualHandoff?.unresolvedQuestions ?? [])
  const unconfirmedGuestSubmission = ref(false)

  const draft = readStoredDraft(key)
  if (draft) {
    const inFlight = !!draft.pending || !!draft.pendingManual
    if (draft.owner === (user?.id ?? null) || (draft.owner === null && !inFlight && !draft.receipt)) {
      restoreForm(form, draft.form); pending.value = draft.pending ?? null; pendingManual.value = draft.pendingManual ?? null; receipt.value = draft.receipt ?? null
      if (draft.originalDescription) originalDescription.value = draft.originalDescription
      if (draft.confirmedRequirements) confirmedRequirements.value = draft.confirmedRequirements
      if (draft.unresolvedQuestions) unresolvedQuestions.value = draft.unresolvedQuestions
    } else if (draft.owner === null && user && inFlight) unconfirmedGuestSubmission.value = true
  }

  function persist(): boolean {
    const draft: StoredDraft = { form: { ...form }, pending: pending.value, pendingManual: pendingManual.value, originalDescription: originalDescription.value,
      confirmedRequirements: confirmedRequirements.value, unresolvedQuestions: unresolvedQuestions.value, receipt: receipt.value, owner: owner.value }
    try { sessionStorage.setItem(key, JSON.stringify(draft)); return true } catch { return false }
  }
  watch(form, persist, { deep: true })
  watch(originalDescription, persist)

  return { form, pending, pendingManual, receipt, owner, originalDescription, confirmedRequirements, unresolvedQuestions, unconfirmedGuestSubmission, persist }
}

export type RequestDraft = ReturnType<typeof useRequestDraft>
