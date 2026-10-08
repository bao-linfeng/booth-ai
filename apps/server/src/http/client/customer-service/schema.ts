import { ENTRY_POINTS } from '../../../modules/customer-service/domain.js';

const uuid = { type: 'string', format: 'uuid' };
const seq = { type: 'integer', minimum: 0 };
const tags = ['client-customer-service'];
const conversationParams = { type: 'object', required: ['conversationId'], properties: { conversationId: uuid } };

export const visitorIssueSchema = { tags, summary: '签发访客令牌' };
export const visitorMergeSchema = { tags, summary: '登录后合并访客会话（需同时携带 X-Visitor-Token）' };

export const openConversationSchema = { tags, summary: '打开或复用未结束会话', body: {
  type: 'object', additionalProperties: false, required: ['entryPoint'], properties: {
    entryPoint: { type: 'string', enum: [...ENTRY_POINTS] },
    context: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['kind', 'schemeCode'], properties: { kind: { const: 'scheme' }, schemeCode: { type: 'string', minLength: 1, maxLength: 200 } } },
      { type: 'object', additionalProperties: false, required: ['kind', 'projectId'], properties: { kind: { const: 'project' }, projectId: uuid } },
    ] },
  },
} };

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
