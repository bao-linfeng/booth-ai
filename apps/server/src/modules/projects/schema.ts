import { currencyScales } from './domain.js';

// 请求 schema 都以字面量类型声明（as const），路由经 json-schema-to-ts 推导请求类型，并与领域输入类型互相校验。
type TextSchema = { readonly type: 'string'; readonly minLength: number; readonly maxLength: number; readonly pattern?: string };
/** minLength > 0 时要求至少一个非空白字符 */
export const text = (maxLength: number, minLength = 0): TextSchema => ({
  type: 'string',
  minLength,
  maxLength,
  ...(minLength ? { pattern: '\\S' } : {}),
});
export const keySchema = { type: 'string', minLength: 8, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' } as const;
export const revisionSchema = { type: 'integer', minimum: 1 } as const;
export const uuid = { type: 'string', format: 'uuid' } as const;
export const projectParams = {
  type: 'object',
  additionalProperties: false,
  required: ['projectId'],
  properties: { projectId: uuid },
} as const;
export const statuses = ['pending', 'following', 'quoted', 'won', 'lost', 'closed'] as const;
export const currencyCodes = Object.keys(currencyScales);
export const queryProperties = {
  page: { type: 'integer', minimum: 1, default: 1 },
  pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  projectNo: text(200),
  schemeCode: text(200),
  status: { type: 'string', enum: statuses },
  sourceType: { type: 'string', enum: ['quote_request', 'manual_request'] },
  exhibitionName: text(200),
  createdFrom: { type: 'string', format: 'date' },
  createdTo: { type: 'string', format: 'date' },
} as const;
const change = { requestKey: keySchema, expectedRevision: revisionSchema } as const;
export const assignmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requestKey', 'expectedRevision', 'assigneeAdminId', 'reason'],
  properties: { ...change, assigneeAdminId: uuid, reason: text(2000, 1) },
} as const;
export const linkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requestKey', 'expectedRevision', 'schemeCode', 'confirmationNote'],
  properties: {
    ...change,
    schemeCode: text(200, 1),
    bomRevision: revisionSchema,
    drawingRevision: revisionSchema,
    confirmationNote: text(2000, 1),
  },
} as const;
const sent = { sentAt: { type: 'string', format: 'date-time' }, channel: text(100, 1) } as const;
export const followUpSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requestKey', 'expectedRevision', 'contactMethod', 'contactedAt', 'content'],
  properties: {
    ...change,
    contactMethod: { type: 'string', enum: ['phone', 'email', 'customer_service', 'meeting', 'other'] },
    contactedAt: { type: 'string', format: 'date-time' },
    content: text(5000, 1),
    nextFollowUpAt: { type: 'string', format: 'date-time' },
    targetStatus: { type: 'string', enum: statuses },
    outcome: text(5000),
    reopenReason: text(2000),
    publicResult: text(5000),
    quoteEvidence: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'quotationRevision', 'sentAt', 'channel'],
          properties: { type: { const: 'platform' }, quotationRevision: revisionSchema, ...sent },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'reference', 'sentAt', 'channel'],
          properties: { type: { const: 'external_manual' }, reference: text(2000, 1), ...sent },
        },
      ],
    },
  },
} as const;
const decimal = { type: 'string', pattern: '^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,6})?$' } as const;
export const quotationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requestKey',
    'expectedRevision',
    'expectedQuotationRevision',
    'currency',
    'priceBasis',
    'validUntil',
    'validityTimeZone',
    'items',
    'terms',
    'inclusions',
    'exclusions',
    'changeReason',
  ],
  properties: {
    ...change,
    expectedQuotationRevision: { type: 'integer', minimum: 0 },
    currency: { type: 'string', enum: currencyCodes },
    priceBasis: { type: 'string', enum: ['included', 'excluded', 'not_applicable'] },
    validUntil: { type: 'string', format: 'date' },
    validityTimeZone: text(100, 1),
    terms: text(5000),
    inclusions: text(5000),
    exclusions: text(5000),
    changeReason: text(2000, 1),
    items: {
      type: 'array',
      maxItems: 10000,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clientLineId', 'kind', 'name', 'quantity', 'pricingUnit', 'unitPrice'],
        properties: {
          clientLineId: text(128, 1),
          kind: { type: 'string', enum: ['material', 'graphic', 'transport', 'installation', 'other'] },
          bomItemId: uuid,
          name: text(500, 1),
          model: text(500),
          specificationMm: text(1000),
          quantity: decimal,
          pricingUnit: text(100, 1),
          unitPrice: { anyOf: [decimal, { type: 'null' }] },
          erpCode: text(200),
          notes: text(2000),
          differenceReason: text(2000),
        },
      },
    },
  },
} as const;
