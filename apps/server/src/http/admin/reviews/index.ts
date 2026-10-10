import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { TypeProvider } from '../../type-provider.js';
import { adminUserId } from '../../authentication.js';
import { successResponse } from '../../schemas.js';
import { createReview, publishScheme, unpublishScheme } from '../../../modules/schemes/reviews.js';
import { getSchemeReadiness, BLOCKER_MESSAGES, type SchemeReadiness } from '../../../modules/schemes/readiness.js';

function mapReadinessResponse(readiness: SchemeReadiness) {
  return {
    ...readiness,
    blockers: readiness.blockers.map(code => BLOCKER_MESSAGES[code]),
    coreBlockers: readiness.coreBlockers.map(code => BLOCKER_MESSAGES[code]),
  };
}

const codeParams = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: { code: { type: 'string', minLength: 1 } },
} as const;

const string = { type: 'string' } as const;
const integer = { type: 'integer' } as const;
const strings = { type: 'array', items: string } as const;
const assetCount = { type: 'object', additionalProperties: false, required: ['count'], properties: { count: integer } } as const;
const verifiedAssetCount = {
  type: 'object',
  additionalProperties: false,
  required: ['count', 'verified'],
  properties: { count: integer, verified: { type: 'boolean' } },
} as const;

const readinessSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemeCode',
    'schemeRevision',
    'publishStatus',
    'verificationStatus',
    'assets',
    'blockers',
    'coreBlockers',
    'canPublish',
    'canSelect',
  ],
  properties: {
    schemeCode: string,
    schemeRevision: integer,
    publishStatus: string,
    verificationStatus: string,
    assets: {
      type: 'object',
      additionalProperties: false,
      required: ['model', 'checklist', 'rendering', 'mask', 'drawing', 'artwork'],
      properties: {
        model: verifiedAssetCount,
        checklist: verifiedAssetCount,
        rendering: assetCount,
        mask: assetCount,
        drawing: assetCount,
        artwork: assetCount,
      },
    },
    blockers: { ...strings, description: '未满足发布条件的中文说明' },
    coreBlockers: { ...strings, description: '不含审核相关的阻塞项，创建整体审核时使用' },
    canPublish: { type: 'boolean' },
    canSelect: { type: 'boolean' },
  },
} as const;

const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'schemeId', 'requestKey', 'schemeRevision', 'phase', 'decision', 'checks', 'notes', 'adminId', 'createdAt'],
  properties: {
    id: string,
    schemeId: string,
    requestKey: string,
    schemeRevision: integer,
    phase: { type: 'string', enum: ['asset_verification', 'overall'] },
    decision: { type: 'string', enum: ['pass', 'reject'] },
    checks: { type: 'object', additionalProperties: { type: 'boolean' } },
    notes: { type: ['string', 'null'] },
    adminId: { type: ['string', 'null'] },
    createdAt: string,
  },
} as const;

const publishedSchemeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'code', 'revision', 'publishStatus', 'verificationStatus', 'updatedAt'],
  properties: { id: string, code: string, revision: integer, publishStatus: string, verificationStatus: string, updatedAt: string },
} as const;

function decodedCode(code: string): string {
  try {
    return decodeURIComponent(code);
  } catch {
    throw Object.assign(new Error('Invalid scheme code'), { statusCode: 400 });
  }
}

export async function registerAdminReviewsRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/schemes/:code/readiness',
    {
      config: { permissions: ['schemes.readiness'] },
      schema: { tags: ['admin-reviews'], params: codeParams, response: { 200: successResponse(readinessSchema) } },
    },
    async request => ({ code: 0, data: mapReadinessResponse(await getSchemeReadiness(pool, decodedCode(request.params.code))) }) as const,
  );
  routes.post(
    '/schemes/:code/reviews',
    {
      config: { permissions: ['schemes.review'] },
      schema: {
        tags: ['admin-reviews'],
        params: codeParams,
        body: {
          type: 'object',
          required: ['requestKey', 'schemeRevision', 'phase', 'decision', 'checks'],
          additionalProperties: false,
          properties: {
            requestKey: { type: 'string', minLength: 1 },
            schemeRevision: { type: 'integer', minimum: 0 },
            phase: { type: 'string', enum: ['asset_verification', 'overall'] },
            decision: { type: 'string', enum: ['pass', 'reject'] },
            checks: { type: 'object', additionalProperties: { type: 'boolean' } },
            notes: { type: ['string', 'null'] },
          },
        },
        response: { 200: successResponse(reviewSchema) },
      },
    },
    async request =>
      ({ code: 0, data: await createReview(pool, decodedCode(request.params.code), adminUserId(request), request.body) }) as const,
  );
  routes.post(
    '/schemes/:code/publish',
    {
      config: { permissions: ['schemes.publish'] },
      schema: { tags: ['admin-reviews'], params: codeParams, response: { 200: successResponse(publishedSchemeSchema) } },
    },
    async request => ({ code: 0, data: await publishScheme(pool, decodedCode(request.params.code), adminUserId(request)) }) as const,
  );
  routes.post(
    '/schemes/:code/unpublish',
    {
      config: { permissions: ['schemes.unpublish'] },
      schema: {
        tags: ['admin-reviews'],
        params: codeParams,
        body: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string' } } },
        response: { 200: successResponse(publishedSchemeSchema) },
      },
    },
    async request =>
      ({
        code: 0,
        data: await unpublishScheme(pool, decodedCode(request.params.code), adminUserId(request), request.body?.reason),
      }) as const,
  );
}
