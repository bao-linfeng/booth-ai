import { CS_LOCALES, ENTRY_POINTS } from '../modules/customer-service/domain.js';

// 在线客服 DTO 的响应 schema，管理端与参展商端共用（对应 modules/customer-service/domain.ts 的 *Dto）
const string = { type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const integer = { type: 'integer' } as const;
const locale = { type: 'string', enum: CS_LOCALES } as const;

export const contextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'entryPoint', 'createdAt', 'kind', 'snapshot'],
  properties: {
    id: string,
    entryPoint: { type: 'string', enum: ENTRY_POINTS },
    createdAt: string,
    kind: { type: 'string', enum: ['scheme', 'project'] },
    schemeCode: string,
    projectId: string,
    // 卡片发送时冻结的方案或项目摘要，历史卡片字段可能不同，原样返回
    snapshot: { description: '发送卡片时冻结的方案或项目摘要' },
  },
} as const;

export const conversationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'conversationNo',
    'status',
    'agent',
    'contactEmail',
    'hasOfflineMessage',
    'lastPublicSeq',
    'customerReadSeq',
    'agentReadSeq',
    'createdAt',
    'closedAt',
  ],
  properties: {
    id: string,
    conversationNo: string,
    status: { type: 'string', enum: ['queued', 'active', 'closed'] },
    agent: {
      anyOf: [
        { type: 'object', additionalProperties: false, required: ['displayName'], properties: { displayName: nullableString } },
        { type: 'null' },
      ],
    },
    contactEmail: nullableString,
    hasOfflineMessage: { type: 'boolean' },
    lastPublicSeq: { type: ['integer', 'null'] },
    customerReadSeq: integer,
    agentReadSeq: integer,
    createdAt: string,
    closedAt: nullableString,
  },
} as const;

export const translationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['locale', 'status', 'body'],
  properties: { locale, status: { type: 'string', enum: ['pending', 'done', 'failed'] }, body: nullableString },
} as const;

const messageProperties = {
  id: string,
  seq: integer,
  conversationId: string,
  conversationNo: string,
  senderType: { type: 'string', enum: ['customer', 'agent', 'system'] },
  senderName: nullableString,
  body: string,
  locale,
  context: { anyOf: [contextSchema, { type: 'null' }] },
  eventCode: { type: ['string', 'null'], enum: ['claimed', 'released', 'transferred', 'closed', 'merged', 'agent_unavailable', null] },
  eventParams: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
  clientMessageId: nullableString,
  createdAt: string,
} as const;
const messageRequired = [
  'id',
  'seq',
  'conversationId',
  'conversationNo',
  'senderType',
  'senderName',
  'kind',
  'body',
  'locale',
  'context',
  'eventCode',
  'eventParams',
  'clientMessageId',
  'createdAt',
] as const;

export const messageSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...messageRequired, 'translation'],
  properties: {
    ...messageProperties,
    kind: { type: 'string', enum: ['text', 'offline', 'context', 'event'] },
    translation: { anyOf: [translationSchema, { type: 'null' }] },
  },
} as const;

export const adminMessageSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...messageRequired, 'visibility', 'senderAdminId', 'translations'],
  properties: {
    ...messageProperties,
    kind: { type: 'string', enum: ['text', 'offline', 'context', 'event', 'note'] },
    visibility: { type: 'string', enum: ['public', 'internal'] },
    senderAdminId: nullableString,
    translations: { type: 'array', items: translationSchema },
  },
} as const;

export const adminConversationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...conversationSchema.required,
    'customer',
    'customerLocale',
    'agentAdminId',
    'agentName',
    'awaitingSince',
    'claimedAt',
    'lastMessageAt',
    'lastMessagePreview',
    'unreadCount',
    'contextSummary',
  ],
  properties: {
    ...conversationSchema.properties,
    customer: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'userId', 'username', 'displayName', 'email'],
          properties: {
            kind: { type: 'string', const: 'user' },
            userId: string,
            username: string,
            displayName: nullableString,
            email: nullableString,
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'visitorId'],
          properties: { kind: { type: 'string', const: 'visitor' }, visitorId: string },
        },
      ],
    },
    customerLocale: locale,
    agentAdminId: nullableString,
    agentName: nullableString,
    awaitingSince: nullableString,
    claimedAt: nullableString,
    lastMessageAt: nullableString,
    lastMessagePreview: nullableString,
    unreadCount: integer,
    contextSummary: { type: 'array', items: string },
  },
} as const;

export const messagePageSchema = <const T>(item: T) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: ['items', 'hasMore'],
    properties: { items: { type: 'array', items: item }, hasMore: { type: 'boolean' } },
  }) as const;
