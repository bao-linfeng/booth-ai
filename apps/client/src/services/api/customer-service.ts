import { API_BASE_URL, apiFetch } from '@/lib/api-client'

// 在线客服客户端接口（服务端 /api/v1/client/customer-service，契约见在线客服模块开发计划 §6）
export type CsLocale = 'zh' | 'en' | 'fr' | 'de' | 'ja' | 'ru' | 'it' | 'es' | 'ar' | 'hi' | 'pt' | 'ms'
export type EntryPoint = 'scheme_detail' | 'quote_receipt' | 'my_project' | 'floating'
export type ConversationStatus = 'queued' | 'active' | 'closed'
export type EventCode = 'claimed' | 'released' | 'transferred' | 'closed' | 'merged' | 'agent_unavailable'
export type ContextInput = { kind: 'scheme'; schemeCode: string } | { kind: 'project'; projectId: string }

export interface ConversationDto {
  id: string
  conversationNo: string
  status: ConversationStatus
  /** displayName 为空时显示“客服” */
  agent: { displayName: string | null } | null
  contactEmail: string | null
  hasOfflineMessage: boolean
  lastPublicSeq: number | null
  customerReadSeq: number
  agentReadSeq: number
  createdAt: string
  closedAt: string | null
}

export interface SchemeSnapshot { schemeCode: string; name: string; lengthMm: number | null; widthMm: number | null; openingCount: number | null }
export interface ProjectSnapshot {
  projectNo: string; schemeCode: string | null; sourceType: 'quote_request' | 'manual_request'; status: string
  customerType: 'individual' | 'company'; countryCode: string; city: string; exhibitionName: string; submittedAt: string
}
export type ContextDto = { id: string; entryPoint: EntryPoint; createdAt: string } &
  ({ kind: 'scheme'; schemeCode: string; snapshot: SchemeSnapshot } | { kind: 'project'; projectId: string; snapshot: ProjectSnapshot })

export interface TranslationDto { locale: CsLocale; status: 'pending' | 'done' | 'failed'; body: string | null }

export interface MessageDto {
  id: string
  seq: number
  conversationId: string
  conversationNo: string
  senderType: 'customer' | 'agent' | 'system'
  senderName: string | null
  kind: 'text' | 'offline' | 'context' | 'event'
  body: string
  locale: CsLocale
  context: ContextDto | null
  eventCode: EventCode | null
  eventParams: Record<string, unknown> | null
  translation: TranslationDto | null
  clientMessageId: string | null
  createdAt: string
}

export type CustomerEvent =
  | { type: 'message.created'; message: MessageDto }
  | { type: 'message.translated'; messageId: string; seq: number; translation: TranslationDto }
  | { type: 'conversation.updated'; conversation: ConversationDto }
  | { type: 'read'; agentReadSeq: number }
  | { type: 'ready'; conversation: ConversationDto | null }

export interface OpenResult { conversation: ConversationDto; contexts: ContextDto[]; agentsOnline: boolean }
export interface CurrentResult { conversation: ConversationDto | null; contexts: ContextDto[]; unreadCount: number; agentsOnline: boolean }

const base = '/api/v1/client/customer-service'
type Envelope<T> = { code: number; data: T }

/** 签发访客：令牌由服务端写入 HttpOnly Cookie，响应体不含令牌 */
export async function issueVisitor(): Promise<{ visitorId: string }> {
  return (await apiFetch<Envelope<{ visitorId: string }>>(`${base}/visitors`, { method: 'POST' })).data
}

/** 登录后合并访客会话：登录令牌由请求拦截注入，访客令牌由浏览器随 Cookie 携带 */
export async function mergeVisitor(): Promise<{ mergedConversations: number }> {
  return (await apiFetch<Envelope<{ mergedConversations: number }>>(`${base}/visitors/merge`, { method: 'POST' })).data
}

export async function openConversation(entryPoint: EntryPoint, context?: ContextInput): Promise<OpenResult> {
  return (await apiFetch<Envelope<OpenResult>>(`${base}/conversations`, { method: 'POST', body: { entryPoint, ...(context ? { context } : {}) } })).data
}

export async function getCurrentConversation(): Promise<CurrentResult> {
  return (await apiFetch<Envelope<CurrentResult>>(`${base}/conversations/current`)).data
}

export async function listMessages(query: { before?: number; after?: number; limit?: number }): Promise<{ items: MessageDto[]; hasMore: boolean }> {
  return (await apiFetch<Envelope<{ items: MessageDto[]; hasMore: boolean }>>(`${base}/messages`, { query })).data
}

export async function postMessage(conversationId: string, input: { clientMessageId: string; body: string; kind: 'text' | 'offline'; contactEmail?: string }) {
  return (await apiFetch<Envelope<{ message: MessageDto; conversation: ConversationDto }>>(
    `${base}/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: input })).data
}

export async function markRead(conversationId: string, seq: number): Promise<{ customerReadSeq: number }> {
  return (await apiFetch<Envelope<{ customerReadSeq: number }>>(
    `${base}/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST', body: { seq } })).data
}

export async function createEventsTicket(conversationId: string): Promise<string> {
  return (await apiFetch<Envelope<{ ticket: string }>>(
    `${base}/conversations/${encodeURIComponent(conversationId)}/events-ticket`, { method: 'POST' })).data.ticket
}

export function openCustomerServiceEvents(conversationId: string, ticket: string, after: number): EventSource {
  return new EventSource(`${API_BASE_URL.replace(/\/+$/, '')}${base}/conversations/${encodeURIComponent(conversationId)}/events`
    + `?ticket=${encodeURIComponent(ticket)}&after=${after}`)
}

/** 服务端错误原因（4xx 时返回 error.reason） */
export function errorReason(failure: unknown): { status?: number; reason?: string } {
  return {
    status: (failure as { response?: { status?: number } }).response?.status,
    reason: (failure as { data?: { error?: { reason?: string } } }).data?.error?.reason,
  }
}
