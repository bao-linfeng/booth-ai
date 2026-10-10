import { successResponse } from '../../schemas.js';
import { eventsTicketSchema, generationCreditsSchema } from '../theme-jobs/schema.js';

const uuid = { type: 'string', format: 'uuid' } as const;
const contextProperties = {
  schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
  themeJobId: uuid,
  resultId: uuid,
  selectionRevision: { type: 'integer', minimum: 1 },
} as const;
const contextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemeCode', 'themeJobId', 'resultId', 'selectionRevision'],
  properties: contextProperties,
} as const;
const jobParams = { type: 'object', required: ['jobId'], properties: { jobId: uuid } } as const;
const nullableString = { type: ['string', 'null'] } as const;
const direction = { type: 'string', enum: ['front', 'back', 'left', 'right'] } as const;

const qualitySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['minLongEdge', 'minShortEdge', 'maxPixels', 'maxBytes'],
  properties: {
    minLongEdge: { type: 'integer' },
    minShortEdge: { type: 'integer' },
    maxPixels: { type: 'integer' },
    maxBytes: { type: 'integer' },
  },
} as const;

const receiptProperties = {
  jobId: { type: 'string' },
  artworkJobId: { type: 'string' },
  status: { type: 'string' },
  deliveryStatus: { type: 'string' },
  reusedRequest: { type: 'boolean' },
  credits: generationCreditsSchema,
  pollAfterMs: { type: ['integer', 'null'] },
} as const;
const receiptRequired = ['jobId', 'artworkJobId', 'status', 'deliveryStatus', 'reusedRequest', 'credits', 'pollAfterMs'] as const;

export const artworkJobSchema = {
  params: jobParams,
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: [
        ...receiptRequired,
        'schemeCode',
        'phase',
        'themeSelection',
        'referencePreviewUrl',
        'directions',
        'missingDirections',
        'mappingStatus',
        'quality',
      ],
      properties: {
        ...receiptProperties,
        schemeCode: { type: 'string' },
        phase: nullableString,
        themeSelection: {
          type: 'object',
          additionalProperties: false,
          required: ['themeJobId', 'resultId', 'selectionRevision'],
          properties: {
            themeJobId: { type: 'string' },
            resultId: { type: 'string' },
            selectionRevision: { type: 'integer' },
          },
        },
        referencePreviewUrl: nullableString,
        // 未生成成功的方向只有 direction/status/reason，文件字段仅在已有结果时出现
        directions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['direction', 'status', 'reason'],
            properties: {
              direction,
              status: { type: 'string' },
              reason: nullableString,
              assetId: { type: 'string' },
              width: { type: 'integer' },
              height: { type: 'integer' },
              byteSize: { type: 'number' },
              filename: { type: 'string' },
              previewUrl: { type: 'string' },
            },
          },
        },
        missingDirections: { type: 'array', items: direction },
        mappingStatus: { type: 'string' },
        quality: qualitySchema,
      },
    }),
  },
} as const;
export const artworkDownloadSchema = { params: jobParams } as const;
export const artworkTicketSchema = { params: jobParams, ...eventsTicketSchema } as const;
export const artworkEventsSchema = {
  params: jobParams,
  querystring: { type: 'object', additionalProperties: false, required: ['ticket'], properties: { ticket: uuid } },
} as const;
export const artworkOfferSchema = {
  body: contextSchema,
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['available', 'offer', 'quality'],
      properties: {
        available: { type: 'boolean' },
        offer: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'expiresAt', 'unitCredits', 'maxCredits', 'settlementRule'],
          properties: {
            id: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
            unitCredits: { type: 'integer' },
            maxCredits: { type: 'integer' },
            settlementRule: { type: 'string' },
          },
        },
        quality: qualitySchema,
      },
    }),
  },
} as const;
export const artworkSubmissionSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['schemeCode', 'themeJobId', 'resultId', 'selectionRevision', 'requestKey', 'offerId'],
    properties: { ...contextProperties, requestKey: uuid, offerId: uuid },
  },
  response: {
    '2xx': successResponse({ type: 'object', additionalProperties: false, required: receiptRequired, properties: receiptProperties }),
  },
} as const;
export const artworkListSchema = {
  querystring: contextSchema,
  response: {
    200: successResponse({
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['jobId', 'status', 'deliveryStatus'],
            properties: { jobId: { type: 'string' }, status: { type: 'string' }, deliveryStatus: { type: 'string' } },
          },
        },
      },
    }),
  },
} as const;
export const artworkAssetSchema = {
  params: {
    type: 'object',
    required: ['jobId', 'assetId'],
    properties: { jobId: uuid, assetId: uuid },
  },
} as const;
