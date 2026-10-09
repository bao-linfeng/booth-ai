import { computed, nextTick, ref, type Ref } from 'vue'
import { parseDate } from '@internationalized/date'
import { useI18n } from 'vue-i18n'
import type { RequestForm } from './form'

export interface RequestFieldErrors {
  exhibitionName: string; countryCode: string; city: string; startDate: string; endDate: string; scope: string; scopeNotes: string
  amount: string; company: string; contactName: string; contact: string
}

// 与服务端 normalizeQuote 的规则一致：预算为正数、最多 12 位整数与 6 位小数（需求预算不按币种小数位限制）；电话 7–15 位数字
const amountPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const validAmount = (value: string) => amountPattern.test(value) && /[1-9]/.test(value)
const validEmail = (value: string) => emailPattern.test(value)
const validPhone = (value: string) => /^\+?[\d ()-]{7,30}$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, ''))

/**
 * 提交前的本地校验：首次提交后才展示错误，修正后即时消失；校验失败时聚焦第一个出错字段。
 * 覆盖服务端会拒绝的全部表单规则（必填项去除首尾空格后判断），服务端仍做最终校验。
 * 需求描述只有人工需求有（传入 description），顺序与页面字段顺序一致。
 */
export function useRequestValidation(form: RequestForm, options: { description?: Ref<string>; isLoggedIn: () => boolean }) {
  const { t } = useI18n()
  const attempted = ref(false)
  const when = (invalid: boolean, key: string) => attempted.value && invalid ? t(`quoteRequest.${key}`) : ''

  function dateError(value: string, key: 'validationStartDate' | 'validationEndDate') {
    const label = t(`quoteRequest.${key}`)
    if (!value) return t('quoteRequest.validationSelect', { label })
    try { if (parseDate(value).toString() === value) return '' } catch {}
    return t('quoteRequest.validationInvalid', { label })
  }

  const descriptionError = computed(() => when(!!options.description && !options.description.value.trim(), 'validationRequirement'))
  const startDate = computed(() => attempted.value ? dateError(form.startDate, 'validationStartDate') : '')
  const endDate = computed(() => {
    if (!attempted.value) return ''
    const invalid = dateError(form.endDate, 'validationEndDate')
    if (invalid) return invalid
    return !startDate.value && form.endDate < form.startDate ? t('quoteRequest.validationDateRange') : ''
  })
  const email = computed(() => form.email.trim())
  const phone = computed(() => form.phone.trim())
  // 未登录提交以邮箱认领：登录后，灵通账号邮箱与此一致的申请会自动归入"我的项目"
  const contactProblem = computed(() => {
    if (!options.isLoggedIn() && !email.value) return { key: 'validationEmailRequired', target: '#email' }
    if (!email.value && !phone.value) return { key: 'validationContact', target: '#email' }
    if (email.value && !validEmail(email.value)) return { key: 'validationEmail', target: '#email' }
    if (phone.value && !validPhone(phone.value)) return { key: 'validationPhone', target: '#phone' }
    return null
  })
  const fieldErrors = computed<RequestFieldErrors>(() => ({
    exhibitionName: when(!form.exhibitionName.trim(), 'validationExhibition'),
    countryCode: when(!/^[A-Za-z]{2}$/.test(form.countryCode), 'validationCountry'),
    city: when(!form.city.trim(), 'validationCity'),
    startDate: startDate.value,
    endDate: endDate.value,
    scope: when(!form.scopeCodes.length, 'validationScope'),
    scopeNotes: when(form.scopeCodes.includes('other') && !form.scopeNotes.trim(), 'validationScopeNote'),
    amount: when(!validAmount(form.amount.trim()), 'validationBudget'),
    company: when(form.customerType === 'company' && !form.company.trim(), 'validationCompany'),
    contactName: when(!form.contactName.trim(), 'validationContactName'),
    contact: attempted.value && contactProblem.value ? t(`quoteRequest.${contactProblem.value.key}`) : '',
  }))

  function validate() {
    attempted.value = true
    const errors = fieldErrors.value
    const firstInvalid = ([
      [descriptionError.value, '#request-description'], [errors.exhibitionName, '#exhibition'], [errors.countryCode, '#country'], [errors.city, '#city'],
      [errors.startDate, '#request-start-date'], [errors.endDate, '#request-end-date'], [errors.scope, '#request-scopes button'], [errors.scopeNotes, '#scope'],
      [errors.amount, '#budget'], [errors.company, '#company'], [errors.contactName, '#contact'], [errors.contact, contactProblem.value?.target ?? '#email'],
    ] as const).find(([message]) => message)
    if (!firstInvalid) return true
    void nextTick(() => document.querySelector<HTMLElement>(firstInvalid[1])?.focus())
    return false
  }

  return { descriptionError, fieldErrors, validate }
}
