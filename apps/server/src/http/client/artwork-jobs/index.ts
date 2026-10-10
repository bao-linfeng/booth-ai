import type { JsonSchemaToTsProvider } from '@fastify/type-provider-json-schema-to-ts';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { clientUserId, issueEventTicket, requirePrincipal } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import { streamArtworkJobEvents } from './events.js';
import { getArtworkJob, listArtworkJobs, ownedArtworkJob } from '../../../modules/generation/artwork/queries.js';
import { createArtworkOffer } from '../../../modules/generation/artwork/offers.js';
import { artworkArchive, downloadArtworkAsset } from '../../../modules/generation/artwork/download.js';
import { submitArtworkJob } from '../../../modules/generation/artwork/submission.js';
import {
  artworkAssetSchema,
  artworkDownloadSchema,
  artworkEventsSchema,
  artworkJobSchema,
  artworkListSchema,
  artworkOfferSchema,
  artworkSubmissionSchema,
  artworkTicketSchema,
} from './schema.js';

export async function registerArtworkJobRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  redis: Redis,
  storage: ReturnType<typeof createStorage>,
) {
  const routes = app.withTypeProvider<JsonSchemaToTsProvider>();
  routes.post('/artwork-jobs/:jobId/events-ticket', { schema: artworkTicketSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = clientUserId(request);
    await ownedArtworkJob(pool, userId, request.params.jobId);
    const ticket = await issueEventTicket(redis, 'artwork', {
      subject: request.params.jobId,
      userId,
      token: requirePrincipal(request, 'client').token,
    });
    return { code: 0, data: { ticket } } as const;
  });
  routes.get(
    '/artwork-jobs/:jobId/events',
    { config: { authentication: 'events', eventTicketPrefix: 'artwork' }, schema: artworkEventsSchema },
    async (request, reply) => {
      const userId = clientUserId(request);
      await ownedArtworkJob(pool, userId, request.params.jobId);
      await streamArtworkJobEvents(pool, redis, request.params.jobId, requirePrincipal(request, 'client'), reply);
    },
  );
  routes.post('/artwork-offers', { preHandler: rateLimit(redis, 'generation'), schema: artworkOfferSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = clientUserId(request);
    return { code: 0, data: await createArtworkOffer(pool, redis, userId, request.body) } as const;
  });
  routes.post('/artwork-jobs', { preHandler: rateLimit(redis, 'generation'), schema: artworkSubmissionSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = clientUserId(request);
    const data = await submitArtworkJob(pool, redis, userId, request.body, request.id);
    if (!data.reusedRequest) request.log.info({ jobKind: 'artwork', jobId: data.jobId }, 'generation job accepted');
    return reply.code(data.reusedRequest ? 200 : 202).send({ code: 0, data });
  });
  routes.get('/artwork-jobs', { schema: artworkListSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = clientUserId(request);
    return { code: 0, data: await listArtworkJobs(pool, userId, request.query) } as const;
  });
  routes.get('/artwork-jobs/:jobId', { schema: artworkJobSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return { code: 0, data: await getArtworkJob(pool, storage, clientUserId(request), request.params.jobId) } as const;
  });
  routes.get('/artwork-jobs/:jobId/download', { schema: artworkDownloadSchema }, async (request, reply) => {
    const archive = await artworkArchive(pool, storage, clientUserId(request), request.params.jobId);
    return reply
      .header('Cache-Control', 'private, no-store')
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="artworks.zip"; filename*=UTF-8''${encodeURIComponent(archive.filename)}`)
      .send(archive.stream);
  });
  routes.get('/artwork-jobs/:jobId/assets/:assetId/download', { schema: artworkAssetSchema }, async (request, reply) => {
    const userId = clientUserId(request);
    const { bytes, filename } = await downloadArtworkAsset(pool, storage, userId, request.params.jobId, request.params.assetId);
    return reply
      .header('Cache-Control', 'private, no-store')
      .type('image/png')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(bytes);
  });
}
