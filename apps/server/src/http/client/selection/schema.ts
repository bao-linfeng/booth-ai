import { requirementSchema } from '../../../modules/selection/domain.js';
import { successResponse } from '../../schemas.js';

const string = { type: 'string' } as const;
const strings = { type: 'array', items: string } as const;
const integer = { type: 'integer' } as const;
const codeParams = { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 200 } } } as const;

const optionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label'],
  properties: {
    id: string,
    value: string,
    label: string,
    labels: { type: 'object', additionalProperties: string },
    aliases: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['locale', 'text'], properties: { locale: string, text: string } },
    },
  },
} as const;
const options = { type: 'array', items: optionSchema } as const;

const catalogSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'boothSpaces',
    'openingCounts',
    'productSystems',
    'styles',
    'industries',
    'budgetTiers',
    'zones',
    'features',
    'rulesVersion',
    'dictionaryVersion',
  ],
  properties: {
    boothSpaces: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'lengthMm', 'widthMm', 'heightMm'],
        properties: { id: string, label: string, lengthMm: integer, widthMm: integer, heightMm: integer },
      },
    },
    openingCounts: options,
    productSystems: options,
    styles: options,
    industries: options,
    budgetTiers: options,
    zones: options,
    features: options,
    rulesVersion: string,
    dictionaryVersion: string,
  },
} as const;

const specificationsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['lengthMm', 'widthMm', 'heightMm', 'areaM2', 'openingCount', 'productSystemId', 'productSystemLabel'],
  properties: {
    lengthMm: integer,
    widthMm: integer,
    heightMm: integer,
    areaM2: { type: 'number' },
    openingCount: integer,
    productSystemId: string,
    productSystemLabel: string,
  },
} as const;

const publicImageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assetId', 'url', 'thumbnailUrl', 'order', 'width', 'height'],
  properties: { assetId: string, url: string, thumbnailUrl: string, order: integer, width: integer, height: integer },
} as const;

const matchItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'matchType', 'images', 'specifications', 'reasons', 'differences', 'pendingConfirmations', 'preferenceMisses'],
  properties: {
    code: string,
    matchType: { type: 'string', enum: ['direct', 'reference', 'random'] },
    images: { type: 'array', items: publicImageSchema },
    specifications: specificationsSchema,
    reasons: strings,
    differences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'requested', 'actual', 'reason'],
        properties: { field: string, requested: string, actual: string, reason: string },
      },
    },
    pendingConfirmations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'message'],
        properties: { type: { type: 'string', const: 'missing_field' }, field: string, message: string },
      },
    },
    preferenceMisses: strings,
  },
} as const;

const diagnosticsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reviewedPublished', 'ready', 'exclusions'],
  properties: {
    reviewedPublished: integer,
    ready: integer,
    exclusions: {
      type: 'object',
      additionalProperties: false,
      required: ['unverifiedChecklist', 'incompleteAssets', 'invalidData', 'productSystem', 'height', 'tags', 'dimensions'],
      properties: {
        unverifiedChecklist: integer,
        incompleteAssets: integer,
        invalidData: integer,
        productSystem: integer,
        height: integer,
        tags: integer,
        dimensions: integer,
      },
    },
  },
} as const;

export const catalogRouteSchema = {
  tags: ['AI 智选'],
  summary: '获取智选公共条件',
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { locale: { type: 'string', pattern: '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$', maxLength: 35 } },
  },
  response: { 200: successResponse(catalogSchema) },
} as const;

export const parseRouteSchema = {
  tags: ['AI 智选'],
  summary: '模型解析需求，失败时规则降级',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'form'],
    properties: {
      attemptId: { type: 'string', format: 'uuid' },
      text: { type: 'string', minLength: 1, maxLength: 1000, pattern: '\\S' },
      form: requirementSchema,
    },
  },
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'requirement',
        'parser',
        'degraded',
        'fieldSources',
        'overrides',
        'clarifications',
        'unhandledText',
        'warnings',
        'rulesVersion',
        'dictionaryVersion',
        'attemptId',
        'parseId',
        'visitorId',
      ],
      properties: {
        status: { type: 'string', enum: ['ready', 'needs_clarification'] },
        requirement: requirementSchema,
        parser: { type: 'string', enum: ['llm', 'rules', 'none'] },
        degraded: { type: 'boolean' },
        fieldSources: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            required: ['source'],
            properties: { source: { type: 'string', enum: ['form', 'text', 'derived'] }, evidence: string },
          },
        },
        overrides: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'previousValue', 'value', 'evidence'],
            properties: {
              field: string,
              previousValue: { description: '覆盖前的取值' },
              value: { description: '覆盖后的取值' },
              evidence: string,
            },
          },
        },
        clarifications: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'reason', 'question', 'candidates'],
            properties: { field: string, reason: string, question: string, candidates: strings },
          },
        },
        unhandledText: strings,
        warnings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'message'],
            properties: { code: string, message: string },
          },
        },
        rulesVersion: string,
        dictionaryVersion: string,
        attemptId: string,
        parseId: string,
        visitorId: string,
      },
    }),
  },
} as const;

export const matchRouteSchema = {
  tags: ['AI 智选'],
  summary: '匹配已审核公开方案',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'inputContext', 'requirement'],
    properties: {
      attemptId: { type: 'string', format: 'uuid' },
      parseId: { type: 'string', format: 'uuid' },
      mode: { type: 'string', enum: ['random', 'filtered'] },
      requirement: requirementSchema,
      inputContext: {
        type: 'object',
        additionalProperties: false,
        required: ['textProvided'],
        properties: { textProvided: { type: 'boolean' }, text: { type: 'string', maxLength: 1000 }, degradedParse: { type: 'boolean' } },
      },
    },
  },
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: [
        'mode',
        'requirement',
        'missingFields',
        'rulesVersion',
        'status',
        'items',
        'counts',
        'diagnostics',
        'reasons',
        'suggestions',
        'dictionaryVersion',
        'attemptId',
        'visitorId',
        'searchId',
      ],
      properties: {
        mode: { type: 'string', enum: ['random', 'filtered'] },
        requirement: requirementSchema,
        missingFields: strings,
        rulesVersion: string,
        status: { type: 'string', enum: ['matched', 'no_match', 'needs_clarification'] },
        items: { type: 'array', items: matchItemSchema },
        counts: {
          type: 'object',
          additionalProperties: false,
          required: ['direct', 'reference', 'random', 'total'],
          properties: { direct: integer, reference: integer, random: integer, total: integer },
        },
        diagnostics: diagnosticsSchema,
        reasons: strings,
        suggestions: strings,
        dictionaryVersion: string,
        attemptId: string,
        visitorId: string,
        searchId: string,
      },
    }),
  },
} as const;

export const coverRouteSchema = {
  tags: ['AI 智选'],
  summary: '方案封面图（302 跳转到第一张效果图的短时签名地址）',
  params: codeParams,
  response: { 302: { description: '跳转到短时签名的图片地址', type: 'null' } },
} as const;

const availability = { type: 'string', enum: ['available', 'unavailable'] } as const;

export const schemeRouteSchema = {
  tags: ['AI 智选'],
  summary: '读取最新公开方案详情',
  params: codeParams,
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['code', 'images', 'specifications', 'description', 'resources', 'actions'],
      properties: {
        code: string,
        images: { type: 'array', items: publicImageSchema },
        specifications: specificationsSchema,
        description: string,
        resources: {
          type: 'object',
          additionalProperties: false,
          required: ['model', 'bom', 'renderings', 'masks', 'drawings', 'artworks'],
          properties: {
            model: { type: 'boolean' },
            bom: { type: 'boolean' },
            renderings: { type: 'boolean' },
            masks: { type: 'boolean' },
            drawings: { type: 'boolean' },
            artworks: { type: 'boolean' },
          },
        },
        actions: {
          type: 'object',
          additionalProperties: false,
          required: ['theme', 'bom', 'drawings', 'artworks', 'quote', 'modelDownload'],
          properties: {
            theme: availability,
            bom: availability,
            drawings: availability,
            artworks: availability,
            quote: availability,
            modelDownload: availability,
          },
        },
      },
    }),
  },
} as const;
