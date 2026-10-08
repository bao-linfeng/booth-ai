import { CS_LOCALES } from '../../../modules/customer-service/domain.js';

const uuid = { type: 'string', format: 'uuid' };
const seq = { type: 'integer', minimum: 0 };
const tags = ['admin-customer-service'];
const conversationParams = { type: 'object', required: ['conversationId'], properties: { conversationId: uuid } };

export const listSchema = { tags, summary: '会话列表（页签或按项目反查）', querystring: {
  type: 'object', additionalProperties: false, properties: {
    tab: { type: 'string', enum: ['queue', 'mine', 'offline', 'all', 'closed'], default: 'queue' },
    page: { type: 'integer', minimum: 1, default: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, projectId: uuid,
  },
} };
export const detailSchema = { tags, summary: '会话详情、上下文、项目负责人与历史会话', params: conversationParams };
export const messagesSchema = { tags, summary: '会话消息（含内部备注与译文）', params: conversationParams, querystring: {
  type: 'object', additionalProperties: false, properties: { before: seq, after: seq, limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } },
} };
export const actionSchema = (summary: string) => ({ tags, summary, params: conversationParams });
export const agentsSchema = { tags, summary: '有效坐席（改派候选）' };
export const transferSchema = { tags, summary: '改派到指定坐席或退回队列', params: conversationParams, body: {
  type: 'object', additionalProperties: false, required: ['reason'], properties: {
    adminId: { anyOf: [uuid, { type: 'null' }] }, reason: { type: 'string', minLength: 1, maxLength: 500 },
  },
} };
export const postMessageSchema = { tags, summary: '回复或写内部备注（clientMessageId 幂等）', params: conversationParams, body: {
  type: 'object', additionalProperties: false, required: ['clientMessageId', 'body', 'kind'], properties: {
    clientMessageId: uuid, body: { type: 'string', minLength: 1, maxLength: 2000 }, kind: { type: 'string', enum: ['text', 'note'] },
  },
} };
export const readSchema = { tags, summary: '上报坐席已读位置', params: conversationParams, body: {
  type: 'object', additionalProperties: false, required: ['seq'], properties: { seq },
} };
export const presenceSchema = { tags, summary: '设置在线 / 离开', body: {
  type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['online', 'away'] } },
} };
export const ticketSchema = { tags, summary: '领取工作台事件流票据' };
export const eventsSchema = { tags, summary: '工作台事件流（SSE，只含 ID）', querystring: {
  type: 'object', additionalProperties: false, required: ['ticket'], properties: { ticket: uuid },
} };
export const getSettingsSchema = { tags, summary: '客服设置' };
export const putSettingsSchema = { tags, summary: '修改客服设置（乐观锁）', body: {
  type: 'object', additionalProperties: false, required: ['translationEnabled', 'agentLocale', 'offlineNotifyEmails', 'replyEmailEnabled', 'expectedRevision'],
  properties: {
    translationEnabled: { type: 'boolean' }, agentLocale: { type: 'string', enum: [...CS_LOCALES] },
    offlineNotifyEmails: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 3, maxLength: 254 } },
    replyEmailEnabled: { type: 'boolean' }, expectedRevision: { type: 'integer', minimum: 1 },
  },
} };
