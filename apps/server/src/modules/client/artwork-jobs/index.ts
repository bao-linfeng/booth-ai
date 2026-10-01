import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { requireProjectUser } from '../quote-requests/index.js';
import { projectError } from '../../projects/domain.js';
import { ARTWORK_QUALITY, artworkArchive, artworkFiles, assertThemeSelection, createArtworkJob, getArtworkJob,
  loadArtworkSnapshot, ownedArtworkJob, replayArtworkRequest, type ArtworkContext, type ArtworkOffer } from './service.js';

const uuid = { type: 'string', format: 'uuid' };
const contextProperties = { schemeCode: { type: 'string', minLength: 1, maxLength: 200 }, themeJobId: uuid, resultId: uuid, selectionRevision: { type: 'integer', minimum: 1 } };
const contextRequired = ['schemeCode', 'themeJobId', 'resultId', 'selectionRevision'];
const jobParams = { type: 'object', required: ['jobId'], properties: { jobId: uuid } };

export async function registerArtworkJobRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis, storage: ReturnType<typeof createStorage>) {
  const user = (authorization: string | undefined) => requireProjectUser(authorization, pool, redis);
  app.post<{ Body: ArtworkContext }>('/artwork-offers', { schema: { body: { type: 'object', additionalProperties: false, required: contextRequired, properties: contextProperties } } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = await user(request.headers.authorization);
    const snapshot = await loadArtworkSnapshot(pool, userId, request.body);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const offer: ArtworkOffer = { ...request.body, userId, snapshot, unitCredits: snapshot.model.unitCredits!, expiresAt };
    await redis.set(`artwork-offer:${id}`, JSON.stringify(offer), 'EX', 300);
    return { code: 0, data: { available: true, offer: { id, expiresAt, unitCredits: offer.unitCredits, maxCredits: offer.unitCredits * 4, settlementRule: 'per_usable_direction' }, quality: ARTWORK_QUALITY } };
  });
  app.post<{ Body: ArtworkContext & { requestKey: string; offerId: string } }>('/artwork-jobs', { schema: { body: {
    type: 'object', additionalProperties: false, required: [...contextRequired, 'requestKey', 'offerId'], properties: { ...contextProperties, requestKey: uuid, offerId: uuid },
  } } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = await user(request.headers.authorization);
    const replay = await replayArtworkRequest(pool, userId, request.body.requestKey, request.body);
    if (replay) return { code: 0, data: replay };
    const raw = await redis.get(`artwork-offer:${request.body.offerId}`);
    if (!raw) throw projectError('OFFER_EXPIRED');
    const data = await createArtworkJob(pool, userId, request.body.requestKey, request.body.offerId, request.body, JSON.parse(raw) as ArtworkOffer);
    return reply.code(data.reusedRequest ? 200 : 202).send({ code: 0, data });
  });
  app.get<{ Querystring: ArtworkContext }>('/artwork-jobs', { schema: { querystring: { type: 'object', additionalProperties: false, required: contextRequired, properties: contextProperties } } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = await user(request.headers.authorization);
    await assertThemeSelection(pool, userId, request.query);
    const c = request.query;
    const rows = (await pool.query<{ jobId: string; status: string; deliveryStatus: string }>(`SELECT id AS "jobId",status,delivery_status AS "deliveryStatus" FROM artwork_jobs
      WHERE user_id=$1 AND scheme_code=$2 AND theme_job_id=$3 AND theme_result_id=$4 AND theme_selection_revision=$5 ORDER BY created_at DESC,id DESC`,
      [userId, c.schemeCode, c.themeJobId, c.resultId, c.selectionRevision])).rows;
    return { code: 0, data: { items: rows } };
  });
  app.get<{ Params: { jobId: string } }>('/artwork-jobs/:jobId', { schema: { params: jobParams } }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return { code: 0, data: await getArtworkJob(pool, storage, await user(request.headers.authorization), request.params.jobId) };
  });
  app.get<{ Params: { jobId: string } }>('/artwork-jobs/:jobId/download', { schema: { params: jobParams } }, async (request, reply) => {
    const archive = await artworkArchive(pool, storage, await user(request.headers.authorization), request.params.jobId);
    return reply.header('Cache-Control', 'private, no-store').type('application/zip')
      .header('Content-Disposition', `attachment; filename="artworks.zip"; filename*=UTF-8''${encodeURIComponent(archive.filename)}`).send(archive.buffer);
  });
  app.get<{ Params: { jobId: string; assetId: string } }>('/artwork-jobs/:jobId/assets/:assetId/download', { schema: { params: {
    type: 'object', required: ['jobId', 'assetId'], properties: { jobId: uuid, assetId: uuid },
  } } }, async (request, reply) => {
    const userId = await user(request.headers.authorization);
    await ownedArtworkJob(pool, userId, request.params.jobId);
    const file = (await artworkFiles(pool, request.params.jobId)).find(f => f.assetId === request.params.assetId);
    if (!file) throw projectError('ARTWORK_NOT_FOUND', 404);
    let bytes: Buffer;
    try {
      bytes = await storage.getBuffer(file.objectKey, file.byteSize);
      if (bytes.length !== file.byteSize || createHash('sha256').update(bytes).digest('hex') !== file.checksum) throw new Error('Artwork integrity mismatch');
    } catch { throw projectError('ARTWORK_STORAGE_UNAVAILABLE', 503); }
    return reply.header('Cache-Control', 'private, no-store').type('image/png')
      .header('Content-Disposition', `attachment; filename="${file.direction}.png"`).send(bytes);
  });
}
