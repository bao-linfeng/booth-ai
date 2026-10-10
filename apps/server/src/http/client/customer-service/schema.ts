import { ENTRY_POINTS } from '../../../modules/customer-service/domain.js';
import { contextSchema, conversationSchema, messagePageSchema, messageSchema } from '../../customer-service-schemas.js';
import { successResponse } from '../../schemas.js';

const uuid = { type: 'string', format: 'uuid' } as const;
const seq = { type: 'integer', minimum: 0 } as const;
const tags = ['client-customer-service'];
const conversationParams = { type: 'object', required: ['conversationId'], properties: { conversationId: uuid } } as const;
const contexts = { type: 'array', items: contextSchema } as const;

export const visitorIssueSchema = {
  tags,
  summary: '签发访客令牌（写入 HttpOnly Cookie；已持有有效令牌时复用）',
  response: {
    '2xx': successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['visitorId'],
      properties: { visitorId: { type: 'string' } },
    }),
  },
} as const;
export const visitorMergeSchema = {
  tags,
  summary: '登录后合并访客会话并清除访客 Cookie（需带 X-CS-Visitor 头）',
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['mergedConversations'],
      properties: { mergedConversations: { type: 'integer' } },
    }),
  },
} as const;

const entryPoint = { type: 'string', enum: ENTRY_POINTS } as const;
const context = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'schemeCode'],
      properties: {
        kind: { const: 'scheme' },
        schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
        // 附带本人 AI 换主题任务当前选定的效果图
        themeJobId: uuid,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'projectId'],
      properties: { kind: { const: 'project' }, projectId: uuid },
    },
  ],
} as const;

export const openConversationSchema = {
  tags,
  summary: '打开或复用未结束会话（带上下文时每次追加一张卡片，与消息共用限流额度）',
  body: { type: 'object', additionalProperties: false, required: ['entryPoint'], properties: { entryPoint, context } },
  response: {
    '2xx': successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['conversation', 'contexts', 'agentsOnline'],
      properties: { conversation: conversationSchema, contexts, agentsOnline: { type: 'boolean' } },
    }),
  },
} as const;

const messageWithConversation = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'conversation'],
  properties: { message: messageSchema, conversation: conversationSchema },
} as const;

export const sendContextSchema = {
  tags,
  summary: '发送上下文卡片（每次都追加一条，与消息共用限流额度）',
  params: conversationParams,
  body: { type: 'object', additionalProperties: false, required: ['entryPoint', 'context'], properties: { entryPoint, context } },
  response: { 201: successResponse(messageWithConversation) },
} as const;

export const contextThemeCoverSchema = {
  tags,
  summary: '换主题方案卡片的效果图（302 跳转到短时签名地址；凭上下文 ID 访问，地址固定可长期放在 <img> 中）',
  params: { type: 'object', required: ['contextId'], properties: { contextId: uuid } },
  response: { 302: { description: '跳转到短时签名的图片地址', type: 'null' } },
} as const;

export const currentConversationSchema = {
  tags,
  summary: '当前未结束会话、未读数与坐席在线状态',
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['conversation', 'contexts', 'unreadCount', 'agentsOnline'],
      properties: {
        conversation: { anyOf: [conversationSchema, { type: 'null' }] },
        contexts,
        unreadCount: { type: 'integer' },
        agentsOnline: { type: 'boolean' },
      },
    }),
  },
} as const;

export const messagesQuerySchema = {
  tags,
  summary: '本主体全部轮次的消息时间线（不含内部消息）',
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { before: seq, after: seq, limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } },
  },
  response: { 200: successResponse(messagePageSchema(messageSchema)) },
} as const;

export const postMessageSchema = {
  tags,
  summary: '发送消息或离线留言（clientMessageId 幂等）',
  params: conversationParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['clientMessageId', 'body', 'kind'],
    properties: {
      clientMessageId: uuid,
      body: { type: 'string', minLength: 1, maxLength: 2000 },
      kind: { type: 'string', enum: ['text', 'offline'] },
      contactEmail: { type: 'string', maxLength: 254 },
    },
  },
  response: { '2xx': successResponse(messageWithConversation) },
} as const;

export const readSchema = {
  tags,
  summary: '上报已读位置',
  params: conversationParams,
  body: { type: 'object', additionalProperties: false, required: ['seq'], properties: { seq } },
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['customerReadSeq'],
      properties: { customerReadSeq: { type: 'integer' } },
    }),
  },
} as const;

export const ticketSchema = {
  tags,
  summary: '领取会话事件流票据',
  params: conversationParams,
  response: {
    200: successResponse({ type: 'object', additionalProperties: false, required: ['ticket'], properties: { ticket: { type: 'string' } } }),
  },
} as const;
export const eventsSchema = {
  tags,
  summary: '会话事件流（SSE）',
  params: conversationParams,
  querystring: { type: 'object', additionalProperties: false, required: ['ticket'], properties: { ticket: uuid, after: seq } },
} as const;
