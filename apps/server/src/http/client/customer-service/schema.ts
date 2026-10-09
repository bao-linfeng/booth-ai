import { ENTRY_POINTS } from '../../../modules/customer-service/domain.js';

const uuid = { type: 'string', format: 'uuid' };
const seq = { type: 'integer', minimum: 0 };
const tags = ['client-customer-service'];
const conversationParams = { type: 'object', required: ['conversationId'], properties: { conversationId: uuid } };

export const visitorIssueSchema = { tags, summary: '签发访客令牌（写入 HttpOnly Cookie；已持有有效令牌时复用）' };
export const visitorMergeSchema = { tags, summary: '登录后合并访客会话并清除访客 Cookie（需带 X-CS-Visitor 头）' };

const entryPoint = { type: 'string', enum: [...ENTRY_POINTS] };
const context = { oneOf: [
  { type: 'object', additionalProperties: false, required: ['kind', 'schemeCode'], properties: {
    kind: { const: 'scheme' }, schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
    // 附带本人 AI 换主题任务当前选定的效果图
    themeJobId: uuid,
  } },
  { type: 'object', additionalProperties: false, required: ['kind', 'projectId'], properties: { kind: { const: 'project' }, projectId: uuid } },
] };

export const openConversationSchema = { tags, summary: '打开或复用未结束会话（带上下文时每次追加一张卡片，与消息共用限流额度）', body: {
  type: 'object', additionalProperties: false, required: ['entryPoint'], properties: { entryPoint, context },
} };

export const sendContextSchema = { tags, summary: '发送上下文卡片（每次都追加一条，与消息共用限流额度）', params: conversationParams, body: {
  type: 'object', additionalProperties: false, required: ['entryPoint', 'context'], properties: { entryPoint, context },
} };

export const contextThemeCoverSchema = {
  tags, summary: '换主题方案卡片的效果图（302 跳转到短时签名地址；凭上下文 ID 访问，地址固定可长期放在 <img> 中）',
  params: { type: 'object', required: ['contextId'], properties: { contextId: uuid } },
};

export const currentConversationSchema = { tags, summary: '当前未结束会话、未读数与坐席在线状态' };

export const messagesQuerySchema = { tags, summary: '本主体全部轮次的消息时间线（不含内部消息）', querystring: {
  type: 'object', additionalProperties: false, properties: { before: seq, after: seq, limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } },
} };

export const postMessageSchema = { tags, summary: '发送消息或离线留言（clientMessageId 幂等）', params: conversationParams, body: {
  type: 'object', additionalProperties: false, required: ['clientMessageId', 'body', 'kind'], properties: {
    clientMessageId: uuid, body: { type: 'string', minLength: 1, maxLength: 2000 }, kind: { type: 'string', enum: ['text', 'offline'] },
    contactEmail: { type: 'string', maxLength: 254 },
  },
} };

export const readSchema = { tags, summary: '上报已读位置', params: conversationParams, body: {
  type: 'object', additionalProperties: false, required: ['seq'], properties: { seq },
} };

export const ticketSchema = { tags, summary: '领取会话事件流票据', params: conversationParams };
export const eventsSchema = { tags, summary: '会话事件流（SSE）', params: conversationParams, querystring: {
  type: 'object', additionalProperties: false, required: ['ticket'], properties: { ticket: uuid, after: seq },
} };
