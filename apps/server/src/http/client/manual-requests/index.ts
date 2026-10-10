import type { JsonSchemaToTsProvider } from '@fastify/type-provider-json-schema-to-ts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { requirementSchema } from '../../../modules/selection/domain.js';
import { manualReceiptSchema, quoteSchema } from '../quote-requests/schema.js';
import { text } from '../../../modules/projects/schema.js';
import { optionalClientUserId } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import { requestMessageLocale } from '../../locale.js';
import { successResponse } from '../../schemas.js';
import { createManualProject } from '../../../modules/projects/service.js';
import { resolveVisitor } from '../../../modules/customer-service/visitors.js';
import { visitorToken } from '../customer-service/visitor-cookie.js';

function omit<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as K))) as Omit<T, K>;
}

// 人工需求沿用询价的联系与展会字段，去掉方案、物料修订与主题选择
const manualSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requestKey',
    'entryPoint',
    'exhibition',
    'scopeCodes',
    'materialBudget',
    'customerType',
    'contact',
    'originalDescription',
    'confirmedRequirements',
  ],
  properties: {
    ...omit(quoteSchema.properties, [
      'schemeCode',
      'schemeRevision',
      'bomRevision',
      'drawingRevision',
      'artworkRevision',
      'themeSelection',
      'requirementContext',
    ]),
    originalDescription: text(5000, 1),
    parsedRequirements: requirementSchema,
    confirmedRequirements: requirementSchema,
    unresolvedQuestions: { type: 'array', maxItems: 30, items: text(1000, 1) },
  },
} as const;

export async function registerClientManualRequestRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  app.withTypeProvider<JsonSchemaToTsProvider>().post(
    '/manual-requests',
    {
      preHandler: rateLimit(redis, 'manual', 'anonymousProject'),
      schema: { tags: ['client-manual-requests'], body: manualSchema, response: { '2xx': successResponse(manualReceiptSchema) } },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const userId = optionalClientUserId(request);
      const visitorId = userId ? null : await resolveVisitor(pool, visitorToken(request));
      const result = await createManualProject(pool, userId, request.body, requestMessageLocale(request), visitorId);
      return reply.code(result.replayed ? 200 : 201).send({ code: 0, data: result.receipt });
    },
  );
}
