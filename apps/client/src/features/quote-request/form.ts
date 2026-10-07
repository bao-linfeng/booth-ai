import type { QuoteRequest } from '@/services/api/quote-requests'
import type { CurrentUser } from '@/services/types/user.type'

// 报价申请与人工需求共用的展会、范围预算与联系人表单
export interface RequestForm {
  exhibitionName: string; countryCode: string; city: string; startDate: string; endDate: string
  scopeCodes: string[]; scopeNotes: string; currency: string; amount: string
  customerType: 'company' | 'individual'; company: string; contactName: string; email: string; phone: string; notes: string
}

/** 两类申请提交体中由公共表单决定的部分 */
export type RequestFormPayload = Pick<QuoteRequest, 'exhibition' | 'scopeCodes' | 'scopeNotes' | 'materialBudget' | 'customerType' | 'company' | 'contact' | 'notes'>

export function createRequestForm(user: CurrentUser | null): RequestForm {
  return {
    exhibitionName: '', countryCode: 'CN', city: user?.city ?? '', startDate: '', endDate: '', scopeCodes: ['materials'], scopeNotes: '',
    currency: 'CNY', amount: '', customerType: user?.company ? 'company' : 'individual', company: user?.company ?? '',
    contactName: user?.nickname ?? user?.username ?? '', email: user?.email ?? '', phone: user?.mobile ?? '', notes: '',
  }
}

export function toRequestPayload(form: RequestForm): RequestFormPayload {
  const email = form.email.trim()
  const phone = form.phone.trim()
  return {
    exhibition: { name: form.exhibitionName, countryCode: form.countryCode.toUpperCase(), city: form.city, startDate: form.startDate, endDate: form.endDate },
    scopeCodes: [...form.scopeCodes], scopeNotes: form.scopeNotes, materialBudget: { currency: form.currency, amount: form.amount },
    customerType: form.customerType, company: form.company,
    contact: { name: form.contactName, ...(email ? { email } : {}), ...(phone ? { phone } : {}) }, notes: form.notes,
  }
}
