import { CS_LOCALES } from '../../../modules/customer-service/domain.js';
import { adminConversationSchema, adminMessageSchema, contextSchema, messagePageSchema } from '../../customer-service-schemas.js';
import { successResponse } from '../../schemas.js';

const uuid = { type: 'string', format: 'uuid' } as const;
const seq = { type: 'integer', minimum: 0 } as const;
const tags = ['admin-customer-service'];
const conversationParams = { type: 'object', required: ['conversationId'], properties: { conversationId: uuid } } as const;
const string = { type: 'string' } as const;
const integer = { type: 'integer' } as const;
const nullableString = { type: ['string', 'null'] } as const;

const countsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['queue', 'mine', 'offline'],
  properties: { queue: integer, mine: integer, offline: integer },
} as const;
const conversationResult = {
  type: 'object',
  additionalProperties: false,
  required: ['conversation'],
  properties: { conversation: adminConversationSchema },
} as const;

export const listSchema = {
  tags,
  summary: '会话列表（页签或按项目反查）',
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tab: { type: 'string', enum: ['queue', 'mine', 'offline', 'all', 'closed'], default: 'queue' },
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      projectId: uuid,
    },
  },
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['items', 'total', 'counts'],
      properties: { items: { type: 'array', items: adminConversationSchema }, total: integer, counts: countsSchema },
    }),
  },
} as const;
export const detailSchema = {
  tags,
  summary: '会话详情、上下文、项目负责人与历史会话',
  params: conversationParams,
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['conversation', 'contexts', 'projects', 'history'],
      properties: {
        conversation: adminConversationSchema,
        contexts: { type: 'array', items: contextSchema },
        projects: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['projectId', 'projectNo', 'assigneeName'],
            properties: { projectId: string, projectNo: string, assigneeName: nullableString },
          },
        },
        history: { type: 'array', items: adminConversationSchema },
      },
    }),
  },
} as const;
export const messagesSchema = {
  tags,
  summary: '会话消息（含内部备注与译文）',
  params: conversationParams,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { before: seq, after: seq, limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } },
  },
  response: { 200: successResponse(messagePageSchema(adminMessageSchema)) },
} as const;
export const actionSchema = <const S extends string>(summary: S) =>
  ({ tags, summary, params: conversationParams, response: { 200: successResponse(conversationResult) } }) as const;
export const agentsSchema = {
  tags,
  summary: '有效坐席（改派候选）',
  response: {
    200: successResponse({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['adminId', 'displayName', 'online', 'activeCount'],
        properties: { adminId: string, displayName: string, online: { type: 'boolean' }, activeCount: integer },
      },
    }),
  },
} as const;
export const transferSchema = {
  tags,
  summary: '改派到指定坐席或退回队列',
  params: conversationParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      adminId: { anyOf: [uuid, { type: 'null' }] },
      reason: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
  response: { 200: successResponse(conversationResult) },
} as const;
export const postMessageSchema = {
  tags,
  summary: '回复或写内部备注（clientMessageId 幂等）',
  params: conversationParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['clientMessageId', 'body', 'kind'],
    properties: {
      clientMessageId: uuid,
      body: { type: 'string', minLength: 1, maxLength: 2000 },
      kind: { type: 'string', enum: ['text', 'note'] },
    },
  },
  response: {
    '2xx': successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: { message: adminMessageSchema },
    }),
  },
} as const;
export const readSchema = {
  tags,
  summary: '上报坐席已读位置',
  params: conversationParams,
  body: { type: 'object', additionalProperties: false, required: ['seq'], properties: { seq } },
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['agentReadSeq'],
      properties: { agentReadSeq: integer },
    }),
  },
} as const;
export const presenceSchema = {
  tags,
  summary: '设置在线 / 离开',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['status'],
    properties: { status: { type: 'string', enum: ['online', 'away'] } },
  },
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['status', 'agentsOnline'],
      properties: { status: { type: 'string', enum: ['online', 'away'] }, agentsOnline: { type: 'boolean' } },
    }),
  },
} as const;
export const ticketSchema = {
  tags,
  summary: '领取工作台事件流票据',
  response: { 200: successResponse({ type: 'object', additionalProperties: false, required: ['ticket'], properties: { ticket: string } }) },
} as const;
export const eventsSchema = {
  tags,
  summary: '工作台事件流（SSE，只含 ID）',
  querystring: { type: 'object', additionalProperties: false, required: ['ticket'], properties: { ticket: uuid } },
} as const;

const settingsView = {
  type: 'object',
  additionalProperties: false,
  required: [
    'translationEnabled',
    'agentLocale',
    'offlineNotifyEmails',
    'replyEmailEnabled',
    'revision',
    'updatedAt',
    'translationModelAssigned',
    'offlineNotifyDelivery',
  ],
  properties: {
    translationEnabled: { type: 'boolean' },
    agentLocale: { type: 'string', enum: CS_LOCALES },
    offlineNotifyEmails: { type: 'array', items: string },
    replyEmailEnabled: { type: 'boolean' },
    revision: integer,
    updatedAt: string,
    translationModelAssigned: { type: 'boolean' },
    offlineNotifyDelivery: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['recipient', 'status', 'lastSentAt', 'lastFailedAt', 'lastErrorCode', 'pendingCount'],
        properties: {
          recipient: string,
          status: { type: 'string', enum: ['idle', 'pending', 'retrying', 'sent', 'failed'] },
          lastSentAt: nullableString,
          lastFailedAt: nullableString,
          lastErrorCode: nullableString,
          pendingCount: integer,
        },
      },
    },
  },
} as const;
export const getSettingsSchema = { tags, summary: '客服设置', response: { 200: successResponse(settingsView) } } as const;
export const putSettingsSchema = {
  tags,
  summary: '修改客服设置（乐观锁）',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['translationEnabled', 'agentLocale', 'offlineNotifyEmails', 'replyEmailEnabled', 'expectedRevision'],
    properties: {
      translationEnabled: { type: 'boolean' },
      agentLocale: { type: 'string', enum: CS_LOCALES },
      offlineNotifyEmails: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 3, maxLength: 254 } },
      replyEmailEnabled: { type: 'boolean' },
      expectedRevision: { type: 'integer', minimum: 1 },
    },
  },
  response: { 200: successResponse(settingsView) },
} as const;
