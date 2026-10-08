import { domainError } from '../../lib/errors.js';
import type { MessageLocale } from '../selection/messages/index.js';

// 在线客服领域类型与 DTO 映射（设计：docs/一期功能拆分/在线客服模块详细设计.md，实施：在线客服模块开发计划.md §6）。

export const CS_LOCALES = ['zh', 'en', 'fr', 'de', 'ja', 'ru', 'it', 'es', 'ar', 'hi', 'pt', 'ms'] as const satisfies readonly MessageLocale[];
export type CsLocale = typeof CS_LOCALES[number];
export const ENTRY_POINTS = ['scheme_detail', 'quote_receipt', 'my_project', 'floating'] as const;
export type EntryPoint = typeof ENTRY_POINTS[number];
export type ConversationStatus = 'queued' | 'active' | 'closed';
export type EventCode = 'claimed' | 'released' | 'transferred' | 'closed' | 'merged' | 'agent_unavailable';
export const MAX_BODY_LENGTH = 2000;

export type Subject = { kind: 'user'; userId: string } | { kind: 'visitor'; visitorId: string };
export type ContextInput = { kind: 'scheme'; schemeCode: string } | { kind: 'project'; projectId: string };

export function csError(reason: string, statusCode = 409) {
  return domainError(reason, statusCode);
}

export const notFound = () => csError('CONVERSATION_NOT_FOUND', 404);

export function subjectKey(subject: Subject): string {
  return subject.kind === 'user' ? `user:${subject.userId}` : `visitor:${subject.visitorId}`;
}

/** 会话属于主体的 SQL 条件；$n 为主体 ID */
export function subjectCondition(subject: Subject, alias: string, param: number): [string, string] {
  return subject.kind === 'user' ? [`${alias}.customer_user_id=$${param}`, subject.userId] : [`${alias}.visitor_id=$${param}`, subject.visitorId];
}

// 去掉首尾空白、统一换行；拒绝换行与制表符以外的控制字符
export function normalizeBody(raw: string): string {
  const body = raw.replace(/\r\n?/g, '\n').trim();
  if (!body || body.length > MAX_BODY_LENGTH || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(body)) throw csError('MESSAGE_INVALID', 400);
  return body;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw csError('CONTACT_EMAIL_INVALID', 400);
  return email;
}

export interface SchemeSnapshot { schemeCode: string; name: string; lengthMm: number | null; widthMm: number | null; openingCount: number | null }
export interface ProjectSnapshot {
  projectNo: string; schemeCode: string | null; sourceType: 'quote_request' | 'manual_request'; status: string;
  customerType: 'individual' | 'company'; countryCode: string; city: string; exhibitionName: string; submittedAt: string;
}
export type ContextDto = { id: string; entryPoint: EntryPoint; createdAt: string } &
  ({ kind: 'scheme'; schemeCode: string; snapshot: SchemeSnapshot } | { kind: 'project'; projectId: string; snapshot: ProjectSnapshot });

export interface ConversationDto {
  id: string; conversationNo: string; status: ConversationStatus;
  /** displayName 为空时由前端显示“客服” */
  agent: { displayName: string | null } | null;
  contactEmail: string | null; hasOfflineMessage: boolean;
  lastPublicSeq: number | null; customerReadSeq: number; agentReadSeq: number;
  createdAt: string; closedAt: string | null;
}
export interface AdminConversationDto extends ConversationDto {
  customer: { kind: 'user'; userId: string; username: string; displayName: string | null; email: string | null } | { kind: 'visitor'; visitorId: string };
  customerLocale: CsLocale; agentAdminId: string | null; agentName: string | null;
  awaitingSince: string | null; claimedAt: string | null; lastMessageAt: string | null;
  lastMessagePreview: string | null; unreadCount: number; contextSummary: string[];
}

export interface TranslationDto { locale: CsLocale; status: 'pending' | 'done' | 'failed'; body: string | null }
export interface MessageDto {
  id: string; seq: number; conversationId: string; conversationNo: string;
  senderType: 'customer' | 'agent' | 'system'; senderName: string | null;
  kind: 'text' | 'offline' | 'context' | 'event'; body: string; locale: CsLocale;
  context: ContextDto | null; eventCode: EventCode | null; eventParams: Record<string, unknown> | null;
  /** 仅坐席消息，目标为客户语言 */
  translation: TranslationDto | null;
  clientMessageId: string | null; createdAt: string;
}
export interface AdminMessageDto extends Omit<MessageDto, 'kind' | 'translation'> {
  kind: MessageDto['kind'] | 'note'; visibility: 'public' | 'internal'; senderAdminId: string | null;
  translations: TranslationDto[];
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());
const num = (value: string | number | null): number | null => (value === null ? null : Number(value));

export interface ConversationRow {
  id: string; conversationNo: string; status: ConversationStatus; agentAdminId: string | null;
  agentNickname: string | null; agentUsername: string | null;
  customerUserId: string | null; visitorId: string | null; customerUsername: string | null; customerNickname: string | null; customerEmail: string | null;
  customerLocale: CsLocale; contactEmail: string | null; hasOfflineMessage: boolean;
  lastMessageSeq: string | null; lastPublicSeq: string | null; lastMessageAt: Date | null;
  customerReadSeq: string; agentReadSeq: string; awaitingSince: Date | null; claimedAt: Date | null;
  createdAt: Date; closedAt: Date | null;
}

/** 会话查询列：FROM cs_conversations c LEFT JOIN admins a ON a.id=c.agent_admin_id LEFT JOIN users u ON u.id=c.customer_user_id */
export const conversationColumns = `c.id, c.conversation_no AS "conversationNo", c.status, c.agent_admin_id AS "agentAdminId",
  a.nickname AS "agentNickname", a.username AS "agentUsername", c.customer_user_id AS "customerUserId", c.visitor_id AS "visitorId",
  u.username AS "customerUsername", u.nickname AS "customerNickname", u.email AS "customerEmail",
  c.customer_locale AS "customerLocale", c.contact_email AS "contactEmail", c.has_offline_message AS "hasOfflineMessage",
  c.last_message_seq AS "lastMessageSeq", c.last_public_seq AS "lastPublicSeq", c.last_message_at AS "lastMessageAt",
  c.customer_read_seq AS "customerReadSeq", c.agent_read_seq AS "agentReadSeq", c.awaiting_since AS "awaitingSince",
  c.claimed_at AS "claimedAt", c.created_at AS "createdAt", c.closed_at AS "closedAt"`;
export const conversationJoins = `LEFT JOIN admins a ON a.id=c.agent_admin_id LEFT JOIN users u ON u.id=c.customer_user_id`;

const nickname = (value: string | null) => value?.trim() || null;

export function toCustomerConversation(row: ConversationRow): ConversationDto {
  return {
    id: row.id, conversationNo: row.conversationNo, status: row.status,
    agent: row.agentAdminId ? { displayName: nickname(row.agentNickname) } : null,
    contactEmail: row.contactEmail, hasOfflineMessage: row.hasOfflineMessage,
    lastPublicSeq: num(row.lastPublicSeq), customerReadSeq: Number(row.customerReadSeq), agentReadSeq: Number(row.agentReadSeq),
    createdAt: iso(row.createdAt)!, closedAt: iso(row.closedAt),
  };
}

export function toAdminConversation(row: ConversationRow & { lastMessagePreview?: string | null; unreadCount?: number | string; contextSummary?: string[] | null }): AdminConversationDto {
  return {
    ...toCustomerConversation(row),
    customer: row.customerUserId
      ? { kind: 'user', userId: row.customerUserId, username: row.customerUsername ?? '', displayName: nickname(row.customerNickname), email: row.customerEmail }
      : { kind: 'visitor', visitorId: row.visitorId! },
    customerLocale: row.customerLocale, agentAdminId: row.agentAdminId,
    agentName: row.agentAdminId ? nickname(row.agentNickname) ?? row.agentUsername : null,
    awaitingSince: iso(row.awaitingSince), claimedAt: iso(row.claimedAt), lastMessageAt: iso(row.lastMessageAt),
    lastMessagePreview: row.lastMessagePreview ?? null, unreadCount: Number(row.unreadCount ?? 0), contextSummary: row.contextSummary ?? [],
  };
}

export interface ContextRow { id: string; kind: 'scheme' | 'project'; ref: string; entryPoint: EntryPoint; snapshot: SchemeSnapshot | ProjectSnapshot; createdAt: Date | string }

export function toContext(row: ContextRow): ContextDto {
  const base = { id: row.id, entryPoint: row.entryPoint, createdAt: iso(row.createdAt)! };
  return row.kind === 'scheme'
    ? { ...base, kind: 'scheme', schemeCode: row.ref, snapshot: row.snapshot as SchemeSnapshot }
    : { ...base, kind: 'project', projectId: row.ref, snapshot: row.snapshot as ProjectSnapshot };
}

export interface MessageRow {
  id: string; seq: string; conversationId: string; conversationNo: string;
  senderType: 'customer' | 'agent' | 'system'; senderAdminId: string | null; agentNickname: string | null; agentUsername: string | null;
  customerUsername: string | null; kind: AdminMessageDto['kind']; visibility: 'public' | 'internal'; body: string; locale: CsLocale;
  context: ContextRow | null; eventCode: EventCode | null; eventParams: Record<string, unknown> | null;
  clientMessageId: string | null; createdAt: Date; translations: TranslationDto[];
}

/** 消息查询列：FROM cs_messages m JOIN cs_conversations c ON c.id=m.conversation_id + messageJoins */
export const messageColumns = `m.id, m.seq, m.conversation_id AS "conversationId", c.conversation_no AS "conversationNo",
  m.sender_type AS "senderType", m.sender_admin_id AS "senderAdminId", sa.nickname AS "agentNickname", sa.username AS "agentUsername",
  su.username AS "customerUsername", m.kind, m.visibility, m.body, m.locale, m.event_code AS "eventCode", m.event_params AS "eventParams",
  m.client_message_id AS "clientMessageId", m.created_at AS "createdAt",
  CASE WHEN x.id IS NULL THEN NULL ELSE json_build_object('id',x.id,'kind',x.kind,'ref',x.ref,'entryPoint',x.entry_point,'snapshot',x.snapshot,'createdAt',x.created_at) END AS context,
  COALESCE((SELECT json_agg(json_build_object('locale',t.target_locale,'status',t.status,'body',t.body) ORDER BY t.target_locale)
    FROM cs_message_translations t WHERE t.message_id=m.id), '[]') AS translations`;
export const messageJoins = `LEFT JOIN admins sa ON sa.id=m.sender_admin_id LEFT JOIN users su ON su.id=c.customer_user_id
  LEFT JOIN cs_conversation_contexts x ON x.id=m.context_id`;

// 客户端只看得到事件参数的白名单（改派原因等内部信息不外泄）
const customerEventParams: Record<EventCode, readonly string[]> = {
  claimed: ['agentName'], transferred: ['agentName'], released: [], closed: [], merged: [], agent_unavailable: [],
};

/** 客户端 DTO；internal 消息（内部备注等）一律返回 null，调用方必须过滤 */
export function toCustomerMessage(row: MessageRow): MessageDto | null {
  if (row.visibility !== 'public' || row.kind === 'note') return null;
  const params = row.eventCode && row.eventParams
    ? Object.fromEntries(customerEventParams[row.eventCode].filter(key => key in row.eventParams!).map(key => [key, row.eventParams![key]]))
    : null;
  return {
    id: row.id, seq: Number(row.seq), conversationId: row.conversationId, conversationNo: row.conversationNo,
    senderType: row.senderType, senderName: row.senderType === 'agent' ? nickname(row.agentNickname) : null,
    kind: row.kind, body: row.body, locale: row.locale, context: row.context ? toContext(row.context) : null,
    eventCode: row.eventCode, eventParams: params,
    translation: row.senderType === 'agent' ? row.translations[0] ?? null : null,
    clientMessageId: row.senderType === 'customer' ? row.clientMessageId : null, createdAt: iso(row.createdAt)!,
  };
}

export function toAdminMessage(row: MessageRow): AdminMessageDto {
  return {
    id: row.id, seq: Number(row.seq), conversationId: row.conversationId, conversationNo: row.conversationNo,
    senderType: row.senderType,
    senderName: row.senderType === 'agent' ? nickname(row.agentNickname) ?? row.agentUsername : row.senderType === 'customer' ? row.customerUsername : null,
    senderAdminId: row.senderAdminId, kind: row.kind, visibility: row.visibility, body: row.body, locale: row.locale,
    context: row.context ? toContext(row.context) : null, eventCode: row.eventCode, eventParams: row.eventParams,
    translations: row.translations, clientMessageId: row.clientMessageId, createdAt: iso(row.createdAt)!,
  };
}
