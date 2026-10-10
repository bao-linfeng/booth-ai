import { successResponse } from '../../schemas.js';

const uuid = { type: 'string', format: 'uuid' } as const;
const jobParams = { type: 'object', required: ['jobId'], properties: { jobId: uuid } } as const;
const generationProperties = {
  schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
  sourceAssetId: { type: 'string', minLength: 1, maxLength: 200 },
  input: {
    type: 'object',
    required: ['industryId', 'styleId'],
    additionalProperties: false,
    properties: {
      industryId: { type: 'string', minLength: 1, maxLength: 200 },
      styleId: { type: 'string', minLength: 1, maxLength: 200 },
      brandColors: { type: 'array', maxItems: 3, items: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
      brandKeywords: { type: 'string', maxLength: 200 },
    },
  },
  requestedCount: { type: 'integer', minimum: 1, maximum: 4 },
  cacheMode: { type: 'string', enum: ['reuse', 'refresh'] },
  searchId: uuid,
} as const;

const nullableInteger = { type: ['integer', 'null'] } as const;
const nullableString = { type: ['string', 'null'] } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;

export const generationCreditsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reservedCredits', 'heldCredits', 'chargedCredits', 'releasedCredits'],
  properties: {
    status: { type: 'string', enum: ['not_charged', 'reserved', 'settling', 'settled', 'released'] },
    reservedCredits: { type: 'integer' },
    heldCredits: { type: 'integer' },
    chargedCredits: { type: 'integer' },
    releasedCredits: { type: 'integer' },
  },
} as const;

export const eventsTicketSchema = {
  response: {
    200: successResponse({ type: 'object', additionalProperties: false, required: ['ticket'], properties: { ticket: { type: 'string' } } }),
  },
} as const;

export const themeEventsSchema = {
  querystring: { type: 'object', required: ['ticket'], additionalProperties: false, properties: { ticket: uuid } },
} as const;

export const themeModelsSchema = {
  tags: ['AI 换主题'],
  summary: '可选择的图像模型及每张图积分',
  response: {
    200: successResponse({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'model', 'unitCredits', 'revision'],
        properties: { id: { type: 'string' }, model: { type: 'string' }, unitCredits: nullableInteger, revision: { type: 'integer' } },
      },
    }),
  },
} as const;

const optionPair = {
  type: 'object',
  additionalProperties: false,
  required: ['industryId', 'styleId'],
  properties: { industryId: { type: 'string' }, styleId: { type: 'string' } },
} as const;

export const themeOfferSchema = {
  tags: ['AI 换主题'],
  summary: '获取可生成能力及费用提议（API-092）',
  body: { type: 'object', required: ['schemeCode', 'sourceAssetId'], additionalProperties: false, properties: generationProperties },
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['available', 'blockedReasons', 'limits', 'supportedCombinations', 'offer'],
      properties: {
        available: { type: 'boolean' },
        blockedReasons: { type: 'array', items: { type: 'string' } },
        limits: {
          type: 'object',
          additionalProperties: false,
          required: ['maxBrandColors', 'maxKeywordCharacters', 'allowedCounts'],
          properties: {
            maxBrandColors: { type: 'integer' },
            maxKeywordCharacters: { type: 'integer' },
            allowedCounts: { type: 'array', items: { type: 'integer' } },
          },
        },
        supportedCombinations: { type: 'array', items: optionPair },
        offer: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'expiresAt', 'pricingRevision', 'unitCredits', 'maxCredits', 'settlementRule', 'cacheHit'],
              properties: {
                id: { type: 'string' },
                expiresAt: dateTime,
                pricingRevision: { type: 'integer' },
                unitCredits: { type: 'integer' },
                maxCredits: { type: 'integer' },
                settlementRule: { type: 'string' },
                cacheHit: { type: 'boolean' },
              },
            },
            { type: 'null' },
          ],
        },
      },
    }),
  },
} as const;

export const themeSubmissionSchema = {
  tags: ['AI 换主题'],
  summary: '创建换主题生成任务（API-006）',
  body: {
    type: 'object',
    required: ['requestKey', 'offerId', 'schemeCode', 'sourceAssetId', 'input', 'requestedCount'],
    additionalProperties: false,
    properties: { requestKey: uuid, offerId: { type: 'string', minLength: 1 }, ...generationProperties },
  },
  response: {
    '2xx': successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['jobId', 'status', 'reusedRequest', 'cacheHit', 'credits', 'pollAfterMs'],
      properties: {
        jobId: { type: 'string' },
        status: { type: 'string' },
        reusedRequest: { type: 'boolean' },
        cacheHit: { type: 'boolean' },
        credits: generationCreditsSchema,
        pollAfterMs: nullableInteger,
      },
    }),
  },
} as const;

export const themeJobSchema = {
  tags: ['AI 换主题'],
  summary: '查询换主题任务状态（API-007）',
  params: jobParams,
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: [
        'jobId',
        'schemeCode',
        'searchId',
        'status',
        'phase',
        'requestedCount',
        'usableCount',
        'cacheHit',
        'original',
        'results',
        'selection',
        'credits',
        'failure',
        'pollAfterMs',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        jobId: { type: 'string' },
        schemeCode: { type: 'string' },
        searchId: nullableString,
        status: { type: 'string' },
        phase: nullableString,
        requestedCount: { type: 'integer' },
        usableCount: { type: 'integer' },
        cacheHit: { type: 'boolean' },
        original: {
          type: 'object',
          additionalProperties: false,
          required: ['assetId', 'previewUrl'],
          properties: { assetId: { type: 'string' }, previewUrl: nullableString },
        },
        results: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['resultId', 'previewUrl', 'width', 'height'],
            properties: {
              resultId: { type: 'string' },
              previewUrl: { type: 'string' },
              width: { type: 'integer' },
              height: { type: 'integer' },
            },
          },
        },
        selection: {
          type: 'object',
          additionalProperties: false,
          required: ['resultId', 'revision'],
          properties: { resultId: nullableString, revision: { type: 'integer' } },
        },
        credits: generationCreditsSchema,
        failure: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['reason', 'retryable'],
              properties: { reason: { type: 'string' }, retryable: { type: 'boolean' } },
            },
            { type: 'null' },
          ],
        },
        pollAfterMs: nullableInteger,
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    }),
  },
} as const;

export const themeSelectionSchema = {
  tags: ['AI 换主题'],
  summary: '保存最终效果选择（API-008）',
  params: jobParams,
  body: {
    type: 'object',
    required: ['resultId', 'expectedRevision'],
    additionalProperties: false,
    properties: { resultId: uuid, expectedRevision: { type: 'integer', minimum: 0 } },
  },
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['jobId', 'schemeCode', 'resultId', 'revision', 'selectedAt'],
      properties: {
        jobId: { type: 'string' },
        schemeCode: { type: 'string' },
        resultId: { type: 'string' },
        revision: { type: 'integer' },
        selectedAt: dateTime,
      },
    }),
  },
} as const;
