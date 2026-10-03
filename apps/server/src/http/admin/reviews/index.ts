import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import { createReview, publishScheme, unpublishScheme, type CreateReviewInput } from '../../../modules/schemes/reviews.js';
import { getSchemeReadiness, BLOCKER_MESSAGES, type SchemeReadiness } from '../../../modules/schemes/readiness.js';

function mapReadinessResponse(readiness: SchemeReadiness) {
  return {
    ...readiness,
    blockers: readiness.blockers.map(code => BLOCKER_MESSAGES[code]),
    coreBlockers: readiness.coreBlockers.map(code => BLOCKER_MESSAGES[code]),
    unknownApplicabilityQuestionIds: readiness.unknownApplicabilityQuestionIds,
  };
}

interface CodeParams { code: string }
interface UnpublishBody { reason?: string }

const codeParams = {
  type: 'object', required: ['code'], additionalProperties: false,
  properties: { code: { type: 'string', minLength: 1 } },
};

function decodedCode(params: CodeParams): string {
  try {
    return decodeURIComponent(params.code);
  } catch {
    throw Object.assign(new Error('Invalid scheme code'), { statusCode: 400 });
  }
}

export async function registerAdminReviewsRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get('/schemes/:code/readiness', { schema: { tags: ['admin-reviews'], params: codeParams } }, async request => {
    return { code: 0, data: mapReadinessResponse(await getSchemeReadiness(pool, decodedCode(request.params as CodeParams))) };
  });
  app.post('/schemes/:code/reviews', {
    schema: {
      tags: ['admin-reviews'], params: codeParams,
      body: {
        type: 'object', required: ['requestKey', 'schemeRevision', 'phase', 'decision', 'checks'], additionalProperties: false,
        properties: {
          requestKey: { type: 'string', minLength: 1 },
          schemeRevision: { type: 'integer', minimum: 0 },
          phase: { type: 'string', enum: ['asset_verification', 'overall'] },
          decision: { type: 'string', enum: ['pass', 'reject'] },
          checks: { type: 'object', additionalProperties: { type: 'boolean' } },
          notes: { type: ['string', 'null'] },
        },
      },
    },
  }, async request => {
    return { code: 0, data: await createReview(pool, decodedCode(request.params as CodeParams), adminUserId(request), request.body as CreateReviewInput) };
  });
  app.post('/schemes/:code/publish', { schema: { tags: ['admin-reviews'], params: codeParams } }, async request => {
    return { code: 0, data: await publishScheme(pool, decodedCode(request.params as CodeParams), adminUserId(request)) };
  });
  app.post('/schemes/:code/unpublish', {
    schema: {
      tags: ['admin-reviews'], params: codeParams,
      body: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string' } } },
    },
  }, async request => {
    return { code: 0, data: await unpublishScheme(pool, decodedCode(request.params as CodeParams), adminUserId(request), (request.body as UnpublishBody | undefined)?.reason) };
  });
}
