import { computed, nextTick, ref, type Ref } from 'vue'
import { parseDate } from '@internationalized/date'
import { useI18n } from 'vue-i18n'
import type { RequestForm } from './form'

export interface RequestFieldErrors {
  startDate: string; endDate: string; scope: string; scopeNotes: string; contact: string
}

/**
 * 提交前的本地校验：首次提交后才展示错误，修正后即时消失；校验失败时聚焦第一个出错字段。
 * 需求描述只有人工需求有（传入 description），顺序为 描述 > 日期 > 范围 > 联系方式。
 */
export function useRequestValidation(form: RequestForm, options: { description?: Ref<string>; isLoggedIn: () => boolean }) {
  const { t } = useI18n()
  const attempted = ref(false)

  function dateError(value: string, key: 'validationStartDate' | 'validationEndDate') {
    const label = t(`quoteRequest.${key}`)
    if (!value) return t('quoteRequest.validationSelect', { label })
    try { if (parseDate(value).toString() === value) return '' } catch {}
    return t('quoteRequest.validationInvalid', { label })
  }

  const descriptionError = computed(() => attempted.value && options.description && !options.description.value.trim() ? t('quoteRequest.validationRequirement') : '')
  const startDate = computed(() => attempted.value ? dateError(form.startDate, 'validationStartDate') : '')
  const endDate = computed(() => {
    if (!attempted.value) return ''
    const invalid = dateError(form.endDate, 'validationEndDate')
    if (invalid) return invalid
    return !startDate.value && form.endDate < form.startDate ? t('quoteRequest.validationDateRange') : ''
  })
  const scope = computed(() => attempted.value && !form.scopeCodes.length ? t('quoteRequest.validationScope') : '')
  const scopeNotes = computed(() => attempted.value && form.scopeCodes.includes('other') && !form.scopeNotes.trim() ? t('quoteRequest.validationScopeNote') : '')
  // 未登录提交以邮箱认领：登录后，灵通账号邮箱与此一致的申请会自动归入"我的项目"
  const contact = computed(() => {
    if (!attempted.value) return ''
    if (!options.isLoggedIn() && !form.email.trim()) return t('quoteRequest.validationEmailRequired')
    return !form.email.trim() && !form.phone.trim() ? t('quoteRequest.validationContact') : ''
  })
  const fieldErrors = computed<RequestFieldErrors>(() => ({ startDate: startDate.value, endDate: endDate.value, scope: scope.value, scopeNotes: scopeNotes.value, contact: contact.value }))

  function validate() {
    attempted.value = true
    const firstInvalid = ([
      [descriptionError.value, '#request-description'], [startDate.value, '#request-start-date'], [endDate.value, '#request-end-date'],
      [scope.value, '#request-scopes button'], [scopeNotes.value, '#scope'], [contact.value, '#email'],
    ] as const).find(([message]) => message)
    if (!firstInvalid) return true
    void nextTick(() => document.querySelector<HTMLElement>(firstInvalid[1])?.focus())
    return false
  }

  return { descriptionError, fieldErrors, validate }
}
