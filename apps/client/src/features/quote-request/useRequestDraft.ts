import { reactive, ref, watch } from 'vue'
import type { ProjectReceipt, QuoteRequest } from '@/services/api/quote-requests'
import type { ManualRequest } from '@/services/api/manual-requests'
import type { CurrentUser } from '@/services/types/user.type'
import type { ManualHandoff } from '@/features/selection/handoff'
import { emptyRequirement, type Requirement } from '@/features/selection/types'
import { createRequestForm, type RequestForm } from './form'

interface StoredDraft {
  form: Partial<RequestForm>; pending: QuoteRequest | null; pendingManual?: ManualRequest | null
  originalDescription?: string; confirmedRequirements?: Requirement; unresolvedQuestions?: string[]
  receipt?: ProjectReceipt | null; owner: string | null
}

/** 报价草稿按方案与主题/素材任务区分，同一方案不同主题的填写互不覆盖 */
export function quoteDraftKey(code: string, themeJobId: unknown, artworkJobId: unknown) {
  return `booth:quote-draft:${code}:${String(themeJobId ?? 'standard')}:${String(artworkJobId ?? 'pending')}`
}

/**
 * 申请页草稿：表单、待确认提交（含幂等键）与回执写入 sessionStorage，登录跳转或刷新后恢复。
 * 草稿记录归属账号，只恢复同一账号的草稿；匿名草稿在没有进行中提交或回执时可被任何账号接手。
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

  try {
    const saved = sessionStorage.getItem(key)
    if (saved) {
      const draft = JSON.parse(saved) as StoredDraft
      if (draft.owner === (user?.id ?? null) || (draft.owner === null && !draft.pending && !draft.pendingManual && !draft.receipt)) {
        Object.assign(form, draft.form); pending.value = draft.pending; pendingManual.value = draft.pendingManual ?? null; receipt.value = draft.receipt ?? null
        if (draft.originalDescription) originalDescription.value = draft.originalDescription
        if (draft.confirmedRequirements) confirmedRequirements.value = draft.confirmedRequirements
        if (draft.unresolvedQuestions) unresolvedQuestions.value = draft.unresolvedQuestions
      }
    }
  } catch { sessionStorage.removeItem(key) }

  function persist() {
    const draft: StoredDraft = { form, pending: pending.value, pendingManual: pendingManual.value, originalDescription: originalDescription.value,
      confirmedRequirements: confirmedRequirements.value, unresolvedQuestions: unresolvedQuestions.value, receipt: receipt.value, owner: owner.value }
    sessionStorage.setItem(key, JSON.stringify(draft))
  }
  watch(form, persist, { deep: true })
  watch(originalDescription, persist)

  return { form, pending, pendingManual, receipt, owner, originalDescription, confirmedRequirements, unresolvedQuestions, persist }
}

export type RequestDraft = ReturnType<typeof useRequestDraft>
