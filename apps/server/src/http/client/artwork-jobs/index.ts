import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { clientUserId, issueEventTicket, requirePrincipal } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import { streamArtworkJobEvents } from './events.js';
import { getArtworkJob, listArtworkJobs, ownedArtworkJob } from '../../../modules/generation/artwork/queries.js';
import type { ArtworkContext } from '../../../modules/generation/artwork/types.js';
import { createArtworkOffer } from '../../../modules/generation/artwork/offers.js';
import { artworkArchive, downloadArtworkAsset } from '../../../modules/generation/artwork/download.js';
import { submitArtworkJob, type ArtworkSubmissionInput } from '../../../modules/generation/artwork/submission.js';
import { artworkAssetSchema, artworkEventsSchema, artworkJobSchema, artworkListSchema, artworkOfferSchema, artworkSubmissionSchema } from './schema.js';

export async function registerArtworkJobRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis, storage: ReturnType<typeof createStorage>) {
  app.post<{ Params: { jobId: string } }>('/artwork-jobs/:jobId/events-ticket', { schema: artworkJobSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = clientUserId(request);
    await ownedArtworkJob(pool, userId, request.params.jobId);
    const ticket = await issueEventTicket(redis, 'artwork', { subject: request.params.jobId, userId, token: requirePrincipal(request, 'client').token });
    return { code: 0, data: { ticket } };
  });
  app.get<{ Params: { jobId: string }; Querystring: { ticket: string } }>('/artwork-jobs/:jobId/events', { config: { authentication: 'events', eventTicketPrefix: 'artwork' }, schema: artworkEventsSchema }, async (request, reply) => {
    const userId = clientUserId(request);
    await ownedArtworkJob(pool, userId, request.params.jobId);
    await streamArtworkJobEvents(pool, redis, request.params.jobId, userId, reply);
  });
  app.post<{ Body: ArtworkContext }>('/artwork-offers', { preHandler: rateLimit(redis, 'generation'), schema: artworkOfferSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = clientUserId(request);
    return { code: 0, data: await createArtworkOffer(pool, redis, userId, request.body) };
  });
  app.post<{ Body: ArtworkSubmissionInput }>('/artwork-jobs', { preHandler: rateLimit(redis, 'generation'), schema: artworkSubmissionSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = clientUserId(request);
    const data = await submitArtworkJob(pool, redis, userId, request.body, request.id);
    if (!data.reusedRequest) request.log.info({ jobKind: 'artwork', jobId: data.jobId }, 'generation job accepted');
    return reply.code(data.reusedRequest ? 200 : 202).send({ code: 0, data });
  });
  app.get<{ Querystring: ArtworkContext }>('/artwork-jobs', { schema: artworkListSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = clientUserId(request);
    return { code: 0, data: await listArtworkJobs(pool, userId, request.query) };
  });
  app.get<{ Params: { jobId: string } }>('/artwork-jobs/:jobId', { schema: artworkJobSchema }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return { code: 0, data: await getArtworkJob(pool, storage, clientUserId(request), request.params.jobId) };
  });
  app.get<{ Params: { jobId: string } }>('/artwork-jobs/:jobId/download', { schema: artworkJobSchema }, async (request, reply) => {
    const archive = await artworkArchive(pool, storage, clientUserId(request), request.params.jobId);
    return reply.header('Cache-Control', 'private, no-store').type('application/zip')
      .header('Content-Disposition', `attachment; filename="artworks.zip"; filename*=UTF-8''${encodeURIComponent(archive.filename)}`).send(archive.stream);
  });
  app.get<{ Params: { jobId: string; assetId: string } }>('/artwork-jobs/:jobId/assets/:assetId/download', { schema: artworkAssetSchema }, async (request, reply) => {
    const userId = clientUserId(request);
    const { bytes, filename } = await downloadArtworkAsset(pool, storage, userId, request.params.jobId, request.params.assetId);
    return reply.header('Cache-Control', 'private, no-store').type('image/png')
      .header('Content-Disposition', `attachment; filename="${filename}"`).send(bytes);
  });
}
