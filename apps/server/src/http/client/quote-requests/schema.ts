import { requirementSchema } from '../../../modules/selection/domain.js';
import { scopeCodes } from '../../../modules/projects/domain.js';
import { currencyCodes, keySchema, revisionSchema, text } from '../../../modules/projects/schema.js';

export const quoteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requestKey', 'schemeCode', 'entryPoint', 'exhibition', 'scopeCodes', 'materialBudget', 'customerType', 'contact'],
  properties: {
    requestKey: keySchema,
    schemeCode: text(200, 1),
    schemeRevision: revisionSchema,
    bomRevision: revisionSchema,
    drawingRevision: revisionSchema,
    artworkRevision: revisionSchema,
    artworkJobId: { type: 'string', format: 'uuid' },
    entryPoint: { type: 'string', enum: ['scheme_detail', 'bill_of_materials', 'theme_result', 'matching_results', 'su'] },
    exhibition: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'countryCode', 'city', 'startDate', 'endDate'],
      properties: {
        name: text(200, 1),
        countryCode: { type: 'string', pattern: '^[A-Z]{2}$' },
        city: text(100, 1),
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
      },
    },
    scopeCodes: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'string', enum: scopeCodes } },
    scopeNotes: text(2000),
    materialBudget: {
      type: 'object',
      additionalProperties: false,
      required: ['currency', 'amount'],
      properties: {
        currency: { type: 'string', enum: currencyCodes },
        amount: { type: 'string', pattern: '^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,6})?$' },
      },
    },
    customerType: { type: 'string', enum: ['individual', 'company'] },
    company: text(200),
    contact: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: text(100, 1), email: text(254), phone: text(30) },
    },
    notes: text(2000),
    themeSelection: {
      type: 'object',
      additionalProperties: false,
      required: ['themeJobId', 'resultId', 'selectionRevision'],
      properties: {
        themeJobId: { type: 'string', format: 'uuid' },
        resultId: { type: 'string', format: 'uuid' },
        selectionRevision: revisionSchema,
      },
    },
    requirementContext: {
      type: 'object',
      additionalProperties: false,
      required: ['originalDescription', 'confirmedRequirements'],
      properties: {
        originalDescription: text(5000),
        confirmedRequirements: requirementSchema,
      },
    },
  },
} as const;

// 回执可能来自幂等重放（project_operations 中保存的历史回执），字段只声明不设 required，避免旧回执缺字段时序列化失败
const materialsStatus = {
  type: 'object',
  additionalProperties: false,
  properties: { bom: { type: 'string' }, drawings: { type: 'string' }, artworks: { type: 'string' } },
} as const;
const nullableRevision = { type: ['integer', 'null'] } as const;

export const quoteReceiptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quoteRequestId: { type: 'string' },
    requestNo: { type: 'string' },
    projectId: { type: 'string' },
    projectNo: { type: 'string' },
    status: { type: 'string' },
    revision: { type: 'integer' },
    schemeCode: { type: 'string' },
    bomRevision: nullableRevision,
    drawingRevision: nullableRevision,
    materialsStatus,
    createdAt: { type: 'string' },
  },
} as const;

export const manualReceiptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    manualRequestId: { type: 'string' },
    requestNo: { type: 'string' },
    projectId: { type: 'string' },
    projectNo: { type: 'string' },
    status: { type: 'string' },
    revision: { type: 'integer' },
    schemeCode: { type: 'null' },
    createdAt: { type: 'string' },
  },
} as const;

export const quoteContextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemeCode', 'schemeRevision', 'bomRevision', 'drawingRevision', 'artworkRevision', 'materialsStatus'],
  properties: {
    schemeCode: { type: 'string' },
    schemeRevision: { type: 'integer' },
    bomRevision: nullableRevision,
    drawingRevision: nullableRevision,
    artworkRevision: nullableRevision,
    materialsStatus,
  },
} as const;
