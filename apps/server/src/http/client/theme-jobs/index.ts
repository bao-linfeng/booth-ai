import type { JsonSchemaToTsProvider } from '@fastify/type-provider-json-schema-to-ts';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { clientUserId, issueEventTicket, requirePrincipal } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import type { createStorage } from '../../../infra/storage.js';
import { streamThemeJobEvents } from './events.js';
import {
  eventsTicketSchema,
  themeEventsSchema,
  themeJobSchema,
  themeModelsSchema,
  themeOfferSchema,
  themeSelectionSchema,
  themeSubmissionSchema,
} from './schema.js';
import { getThemeJob, ownedThemeJob, selectThemeResult } from '../../../modules/generation/theme/queries.js';
import { themeCredits } from '../../../modules/generation/theme/service.js';
import { createThemeOffer, listThemeModels } from '../../../modules/generation/theme/offers.js';
import { submitThemeJob } from '../../../modules/generation/theme/submission.js';

export async function registerThemeModelRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  redis: Redis,
  storage: ReturnType<typeof createStorage>,
) {
  const routes = app.withTypeProvider<JsonSchemaToTsProvider>();
  routes.post('/theme-jobs/:jobId/events-ticket', { schema: { params: themeJobSchema.params, ...eventsTicketSchema } }, async request => {
    const userId = clientUserId(request);
    await ownedThemeJob(pool, userId, request.params.jobId);
    const ticket = await issueEventTicket(redis, 'theme', {
      subject: request.params.jobId,
      userId,
      token: requirePrincipal(request, 'client').token,
    });
    return { code: 0, data: { ticket } } as const;
  });

  routes.get(
    '/theme-jobs/:jobId/events',
    {
      config: { authentication: 'events', eventTicketPrefix: 'theme' },
      schema: { params: themeJobSchema.params, ...themeEventsSchema },
    },
    async (request, reply) => {
      const userId = clientUserId(request);
      await ownedThemeJob(pool, userId, request.params.jobId);
      await streamThemeJobEvents(pool, redis, request.params.jobId, requirePrincipal(request, 'client'), reply);
    },
  );

  routes.get('/theme-models', { schema: themeModelsSchema }, async () => {
    return { code: 0, data: await listThemeModels(pool) } as const;
  });

  routes.post(
    '/theme-offers',
    {
      preHandler: rateLimit(redis, 'generation'),
      schema: themeOfferSchema,
    },
    async request => {
      return { code: 0, data: await createThemeOffer(pool, redis, clientUserId(request), request.body) } as const;
    },
  );

  routes.post(
    '/theme-jobs',
    {
      preHandler: rateLimit(redis, 'generation'),
      schema: themeSubmissionSchema,
    },
    async (request, reply) => {
      const userId = clientUserId(request);
      const data = await submitThemeJob(pool, redis, userId, request.body, request.id);
      if (!data.reusedRequest)
        request.log.info({ jobKind: 'theme', jobId: data.jobId, cacheHit: data.cacheHit }, 'generation job accepted');
      reply.status(data.cacheHit || data.reusedRequest ? 200 : 202);
      reply.header('Location', `/api/v1/client/theme-jobs/${data.jobId}`);
      return { code: 0, data } as const;
    },
  );

  routes.get('/theme-jobs/:jobId', { schema: themeJobSchema }, async request => {
    const userId = clientUserId(request);
    const { jobId } = request.params;
    const { job, results: rows } = await getThemeJob(pool, userId, jobId);
    const results = await Promise.all(
      rows.map(async r => ({
        resultId: r.id,
        previewUrl: await storage.signDownload(r.objectKey, 900),
        width: r.width ?? 0,
        height: r.height ?? 0,
      })),
    );
    const isTerminal = ['succeeded', 'partially_succeeded', 'failed'].includes(job.status);
    const originalPreviewUrl = job.sourceObjectKey ? await storage.signDownload(job.sourceObjectKey, 900) : null;

    return {
      code: 0 as const,
      data: {
        jobId: job.id,
        schemeCode: job.schemeCode,
        searchId: job.searchId,
        status: job.status,
        phase: job.phase,
        requestedCount: job.requestedCount,
        usableCount: job.usableCount,
        cacheHit: job.cacheHit,
        original: { assetId: job.sourceAssetId, previewUrl: originalPreviewUrl },
        results,
        selection: { resultId: job.selectedResultId, revision: job.selectionRevision },
        credits: themeCredits(job),
        failure: job.status === 'failed' ? { reason: 'GENERATION_FAILED', retryable: true } : null,
        pollAfterMs: isTerminal ? null : 2000,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    };
  });

  routes.put('/theme-jobs/:jobId/selection', { schema: themeSelectionSchema }, async request => {
    const userId = clientUserId(request);
    const { jobId } = request.params;
    const { resultId, expectedRevision } = request.body;
    return { code: 0, data: await selectThemeResult(pool, userId, jobId, resultId, expectedRevision) } as const;
  });
}
