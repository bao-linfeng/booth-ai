import type { ProjectStatus } from './projects';

import { useAppConfig } from '@vben/hooks';

import { requestClient } from '#/api/request';

/** 在线客服管理端接口（服务端 /api/v1/admin/customer-service，契约见在线客服模块开发计划 §6） */
export type CsLocale =
  | 'ar'
  | 'de'
  | 'en'
  | 'es'
  | 'fr'
  | 'hi'
  | 'it'
  | 'ja'
  | 'ms'
  | 'pt'
  | 'ru'
  | 'zh';
export type ConversationStatus = 'active' | 'closed' | 'queued';
export type ConversationTab = 'all' | 'closed' | 'mine' | 'offline' | 'queue';
export type EntryPoint =
  | 'floating'
  | 'my_project'
  | 'quote_receipt'
  | 'scheme_detail';
export type EventCode =
  | 'agent_unavailable'
  | 'claimed'
  | 'closed'
  | 'merged'
  | 'released'
  | 'transferred';

export interface SchemeSnapshot {
  schemeCode: string;
  name: string;
  lengthMm: null | number;
  widthMm: null | number;
  openingCount: null | number;
  /** 从换主题结果页发出的卡片：发送时选定的 AI 换主题效果图 */
  themeResultId?: string;
}
export interface ProjectSnapshot {
  projectNo: string;
  schemeCode: null | string;
  sourceType: 'manual_request' | 'quote_request';
  status: ProjectStatus;
  customerType: 'company' | 'individual';
  countryCode: string;
  city: string;
  exhibitionName: string;
  submittedAt: string;
}
export type ConversationContext = {
  createdAt: string;
  entryPoint: EntryPoint;
  id: string;
} & (
  | { kind: 'project'; projectId: string; snapshot: ProjectSnapshot }
  | { kind: 'scheme'; schemeCode: string; snapshot: SchemeSnapshot }
);

export interface AdminConversation {
  id: string;
  conversationNo: string;
  status: ConversationStatus;
  agent: null | { displayName: null | string };
  contactEmail: null | string;
  hasOfflineMessage: boolean;
  lastPublicSeq: null | number;
  customerReadSeq: number;
  agentReadSeq: number;
  createdAt: string;
  closedAt: null | string;
  customer:
    | {
        displayName: null | string;
        email: null | string;
        kind: 'user';
        userId: string;
        username: string;
      }
    | { kind: 'visitor'; visitorId: string };
  customerLocale: CsLocale;
  agentAdminId: null | string;
  agentName: null | string;
  awaitingSince: null | string;
  claimedAt: null | string;
  lastMessageAt: null | string;
  lastMessagePreview: null | string;
  unreadCount: number;
  contextSummary: string[];
}

export interface Translation {
  locale: CsLocale;
  status: 'done' | 'failed' | 'pending';
  body: null | string;
}

export interface AdminMessage {
  id: string;
  seq: number;
  conversationId: string;
  conversationNo: string;
  senderType: 'agent' | 'customer' | 'system';
  senderName: null | string;
  senderAdminId: null | string;
  kind: 'context' | 'event' | 'note' | 'offline' | 'text';
  visibility: 'internal' | 'public';
  body: string;
  locale: CsLocale;
  context: ConversationContext | null;
  eventCode: EventCode | null;
  eventParams: null | Record<string, unknown>;
  translations: Translation[];
  clientMessageId: null | string;
  createdAt: string;
}

export interface ConversationCounts {
  queue: number;
  mine: number;
  offline: number;
}

export interface ConversationPage {
  items: AdminConversation[];
  total: number;
  counts: ConversationCounts;
}

export interface ConversationDetail {
  conversation: AdminConversation;
  contexts: ConversationContext[];
  projects: {
    assigneeName: null | string;
    projectId: string;
    projectNo: string;
  }[];
  history: AdminConversation[];
}

export interface CsAgent {
  adminId: string;
  displayName: string;
  online: boolean;
  activeCount: number;
}

/** 离线通知邮箱投递状态；lastErrorCode 只在 failed / retrying 时有值 */
export interface CsEmailDelivery {
  recipient: string;
  status: 'failed' | 'idle' | 'pending' | 'retrying' | 'sent';
  lastSentAt: null | string;
  lastFailedAt: null | string;
  lastErrorCode: null | string;
  pendingCount: number;
}

export interface CsSettings {
  translationEnabled: boolean;
  agentLocale: CsLocale;
  offlineNotifyEmails: string[];
  offlineNotifyDelivery: CsEmailDelivery[];
  replyEmailEnabled: boolean;
  revision: number;
  translationModelAssigned: boolean;
  updatedAt: string;
}

/** 工作台事件只含 ID，详情由前端拉取 */
export type WorkbenchEvent =
  | {
      agentAdminId: null | string;
      conversationId: string;
      seq?: number;
      status: ConversationStatus;
      type:
        | 'conversation.updated'
        | 'message.created'
        | 'message.translated'
        | 'queue.changed'
        | 'read';
    }
  | { counts: ConversationCounts; type: 'ready' };

const base = '/v1/admin/customer-service';

export const CS_LOCALE_LABELS: Record<CsLocale, string> = {
  zh: '中文',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  ru: 'Русский',
  it: 'Italiano',
  es: 'Español',
  ar: 'العربية',
  hi: 'हिन्दी',
  pt: 'Português',
  ms: 'Bahasa Melayu',
};

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  queued: '排队中',
  active: '接待中',
  closed: '已结束',
};

export const TAB_LABELS: Record<ConversationTab, string> = {
  queue: '待接入',
  mine: '我的进行中',
  offline: '留言待回复',
  all: '全部',
  closed: '已结束',
};

export function listConversationsApi(params: {
  page?: number;
  pageSize?: number;
  projectId?: string;
  tab?: ConversationTab;
}) {
  return requestClient.get<ConversationPage>(`${base}/conversations`, {
    params,
  });
}

export function getConversationApi(id: string) {
  return requestClient.get<ConversationDetail>(`${base}/conversations/${id}`);
}

export function listMessagesApi(
  id: string,
  params: { after?: number; before?: number; limit?: number },
) {
  return requestClient.get<{ hasMore: boolean; items: AdminMessage[] }>(
    `${base}/conversations/${id}/messages`,
    { params },
  );
}

export function claimConversationApi(id: string) {
  return requestClient.post<{ conversation: AdminConversation }>(
    `${base}/conversations/${id}/claim`,
  );
}

export function releaseConversationApi(id: string) {
  return requestClient.post<{ conversation: AdminConversation }>(
    `${base}/conversations/${id}/release`,
  );
}

export function closeConversationApi(id: string) {
  return requestClient.post<{ conversation: AdminConversation }>(
    `${base}/conversations/${id}/close`,
  );
}

export function transferConversationApi(
  id: string,
  input: { adminId: null | string; reason: string },
) {
  return requestClient.post<{ conversation: AdminConversation }>(
    `${base}/conversations/${id}/transfer`,
    input,
  );
}

export function listAgentsApi() {
  return requestClient.get<CsAgent[]>(`${base}/agents`);
}

export function postMessageApi(
  id: string,
  input: { body: string; clientMessageId: string; kind: 'note' | 'text' },
) {
  return requestClient.post<{ message: AdminMessage }>(
    `${base}/conversations/${id}/messages`,
    input,
  );
}

export function markReadApi(id: string, seq: number) {
  return requestClient.post<{ agentReadSeq: number }>(
    `${base}/conversations/${id}/read`,
    { seq },
  );
}

export function setPresenceApi(status: 'away' | 'online') {
  return requestClient.put<{
    agentsOnline: boolean;
    status: 'away' | 'online';
  }>(`${base}/presence`, { status });
}

export function getCsSettingsApi() {
  return requestClient.get<CsSettings>(`${base}/settings`);
}

export function saveCsSettingsApi(
  input: Omit<
    CsSettings,
    | 'offlineNotifyDelivery'
    | 'revision'
    | 'translationModelAssigned'
    | 'updatedAt'
  > & {
    expectedRevision: number;
  },
) {
  return requestClient.put<CsSettings>(`${base}/settings`, input);
}

export async function openWorkbenchEvents(): Promise<EventSource> {
  const { ticket } = await requestClient.post<{ ticket: string }>(
    `${base}/events-ticket`,
  );
  const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
  return new EventSource(
    `${apiURL}${base}/events?ticket=${encodeURIComponent(ticket)}`,
  );
}

/**
 * 会话方案卡片的封面图：参展商端接口，地址固定，服务端每次 302 到短时签名地址，
 * 因此可以直接放进 <img>（图片请求带不了 Bearer，不能走管理端接口）。
 * 换主题卡片凭上下文 ID 取发送时选定的效果图，其余取方案第一张效果图。
 */
export function schemeCardCoverUrl(
  context: Extract<ConversationContext, { kind: 'scheme' }>,
) {
  const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
  return context.snapshot.themeResultId
    ? `${apiURL}/v1/client/customer-service/contexts/${encodeURIComponent(context.id)}/theme-cover`
    : `${apiURL}/v1/client/schemes/${encodeURIComponent(context.snapshot.schemeCode)}/cover`;
}

/** 客户显示名：登录用户为昵称或用户名，访客为“访客 · 邮箱” */
export function customerLabel(conversation: AdminConversation) {
  if (conversation.customer.kind === 'user') {
    return conversation.customer.displayName ?? conversation.customer.username;
  }
  return conversation.contactEmail
    ? `访客 · ${conversation.contactEmail}`
    : '访客';
}

/** 系统事件的中文文案（服务端只存 event_code + params） */
export function eventText(
  message: Pick<AdminMessage, 'eventCode' | 'eventParams'>,
) {
  const params = message.eventParams ?? {};
  const name = (key: string) =>
    typeof params[key] === 'string' && params[key]
      ? String(params[key])
      : '客服';
  switch (message.eventCode) {
    case 'agent_unavailable': {
      return '坐席已不可用，会话重新排队';
    }
    case 'claimed': {
      return `${name('agentName')} 已接入`;
    }
    case 'closed': {
      return '会话已结束';
    }
    case 'merged': {
      return '访客登录后会话已合并';
    }
    case 'released': {
      return '坐席已释放，会话重新排队';
    }
    case 'transferred': {
      const target = params.toQueue
        ? '退回队列'
        : `改派给 ${name('agentName')}`;
      return typeof params.reason === 'string'
        ? `${target}（原因：${params.reason}）`
        : target;
    }
    default: {
      return '系统消息';
    }
  }
}
