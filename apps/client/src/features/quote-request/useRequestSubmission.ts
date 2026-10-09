import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProjectReceipt } from '@/services/api/quote-requests'
import type { RequestDraft } from './useRequestDraft'
import { ensureVisitor } from '@/features/customer-service/visitor'

interface SubmissionOptions<T extends { requestKey: string }> {
  draft: Pick<RequestDraft, 'receipt' | 'owner' | 'persist'>
  /** 待确认的提交；提交结果未知时保留，重试复用同一 requestKey，服务端据此去重 */
  pending: Ref<T | null>
  error: Ref<string>
  /** 传入时 409 视为资料版本冲突，需刷新上下文后重新确认 */
  conflict?: Ref<boolean>
  /** 各类失败提示的 i18n key */
  messages: { accountChanged: string; rejected: string; network: string }
  currentUserId: () => string | null
  /** 没有待确认提交时，是否具备新建提交的前提（如报价上下文已加载） */
  ready: () => boolean
  validate: () => boolean
  build: (requestKey: string) => T
  send: (payload: T) => Promise<ProjectReceipt>
}

/**
 * 申请提交协调：校验通过后生成带幂等键的提交并先写入草稿，再发送。
 * - 结果未知（网络错误、5xx、408、429）保留待确认提交，用户重试时原样重发；
 * - 服务端明确拒绝（其余 4xx、无可用承接人）丢弃待确认提交，修改后重新生成；
 * - 待确认提交属于其他账号时直接丢弃，避免以新账号重发旧账号的申请。
 */
export function useRequestSubmission<T extends { requestKey: string }>(options: SubmissionOptions<T>) {
  const { t } = useI18n()
  const { draft, pending, error, conflict, messages } = options
  const busy = ref(false)

  function rejectionMessage(status: number, reason: string | undefined) {
    if (conflict && status === 409) return t('quoteRequest.errorDataChanged')
    if (status === 401) return t('quoteRequest.errorAuthFailed')
    if (reason === 'CLAIM_EMAIL_REQUIRED') return t('quoteRequest.validationEmailRequired')
    return t(messages.rejected)
  }

  async function submit() {
    if (busy.value || (!pending.value && !options.ready())) return
    const userId = options.currentUserId()
    if (pending.value && draft.owner.value !== userId) { pending.value = null; error.value = t(messages.accountChanged); draft.persist(); return }
    draft.owner.value = userId
    error.value = ''
    if (!pending.value) {
      if (!options.validate()) return
      pending.value = options.build(crypto.randomUUID())
      draft.persist()
    }
    busy.value = true
    // 匿名提交先确保已签发客服访客（令牌在 Cookie 中），服务端据此把项目绑定到本访客，之后可带项目咨询客服；失败不阻塞提交
    if (!userId) await ensureVisitor().catch(() => null)
    try { draft.receipt.value = await options.send(pending.value); pending.value = null; draft.persist() }
    catch (failure: unknown) {
      const status = (failure as { response?: { status?: number } }).response?.status
      const reason = (failure as { data?: { error?: { reason?: string } } }).data?.error?.reason
      if (status === 503 && reason === 'ASSIGNMENT_UNAVAILABLE') {
        pending.value = null
        error.value = t('quoteRequest.errorAssignmentUnavailable')
      } else if (status && status < 500 && status !== 408 && status !== 429) {
        pending.value = null
        if (conflict) conflict.value = status === 409
        error.value = rejectionMessage(status, reason)
      } else { error.value = t(messages.network) }
      draft.persist()
    } finally { busy.value = false }
  }

  return { busy, submit }
}
