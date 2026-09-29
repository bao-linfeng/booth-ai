import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { assertPublished, listDeliverables, signDeliverable, type DeliverableType } from './service.js';

interface Params { code: string; assetId?: string }
interface DownloadQuery { disposition?: 'preview' | 'attachment' }

const codeParams = { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 200 } } };
const assetParams = { type: 'object', required: ['code', 'assetId'], properties: {
  code: { type: 'string', minLength: 1, maxLength: 200 }, assetId: { type: 'string', format: 'uuid' },
} };
const downloadQuery = { type: 'object', additionalProperties: false, properties: {
  disposition: { type: 'string', enum: ['preview', 'attachment'] },
} };

export async function registerClientSchemeAssetRoutes(app: FastifyInstance, pool: pg.Pool, storage: ReturnType<typeof createStorage>): Promise<void> {
  const noStore = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.header('Cache-Control', 'no-store');
  };

  const list = (type: DeliverableType) => async (request: FastifyRequest<{ Params: Params }>) => {
    await assertPublished(pool, request.params.code);
    const rows = await listDeliverables(pool, request.params.code, type);
    return { code: 0, data: {
      schemeCode: request.params.code,
      items: rows.map(({ assetId, name, originalFilename, mimeType, byteSize, sortOrder }) =>
        ({ assetId, name, originalFilename, mimeType, byteSize, sortOrder })),
    } };
  };

  const download = (type: DeliverableType) => async (request: FastifyRequest<{ Params: Params; Querystring: DownloadQuery }>) => {
    const data = await signDeliverable(pool, storage, request.params.code, type, request.params.assetId, request.query.disposition === 'preview');
    return { code: 0, data };
  };

  app.get<{ Params: Params }>('/schemes/:code/drawings', {
    onRequest: noStore, schema: { tags: ['client-schemes'], params: codeParams },
  }, list('drawing'));
  app.get<{ Params: Params }>('/schemes/:code/artworks', {
    onRequest: noStore, schema: { tags: ['client-schemes'], params: codeParams },
  }, list('artwork'));
  app.get<{ Params: Params; Querystring: DownloadQuery }>('/schemes/:code/drawings/:assetId/download', {
    onRequest: noStore, schema: { tags: ['client-schemes'], params: assetParams, querystring: downloadQuery },
  }, download('drawing'));
  app.get<{ Params: Params; Querystring: DownloadQuery }>('/schemes/:code/artworks/:assetId/download', {
    onRequest: noStore, schema: { tags: ['client-schemes'], params: assetParams, querystring: downloadQuery },
  }, download('artwork'));
  app.get<{ Params: Params; Querystring: DownloadQuery }>('/schemes/:code/model/download', {
    onRequest: noStore, schema: { tags: ['client-schemes'], params: codeParams, querystring: downloadQuery },
  }, download('model'));
}
