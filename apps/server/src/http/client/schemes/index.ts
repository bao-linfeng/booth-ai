import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import {
  buildDeliverableArchive,
  getDeliverableSet,
  publicDeliverables,
  signDeliverable,
  type DeliverableType,
} from '../../../modules/assets/deliverables.js';

interface Params {
  code: string;
  assetId?: string;
}
interface DownloadQuery {
  disposition?: 'preview' | 'attachment';
}
interface ArchiveQuery {
  revision: string;
}

const codeParams = { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 200 } } };
const assetParams = {
  type: 'object',
  required: ['code', 'assetId'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 200 },
    assetId: { type: 'string', format: 'uuid' },
  },
};
const downloadQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    disposition: { type: 'string', enum: ['preview', 'attachment'] },
  },
};
const archiveQuery = {
  type: 'object',
  required: ['revision'],
  additionalProperties: false,
  properties: {
    revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  },
};

export async function registerClientSchemeAssetRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  storage: ReturnType<typeof createStorage>,
): Promise<void> {
  const noStore = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.header('Cache-Control', 'no-store');
  };

  const list = (type: DeliverableType) => async (request: FastifyRequest<{ Params: Params }>) => {
    const set = await getDeliverableSet(pool, request.params.code, type);
    return {
      code: 0,
      data: {
        schemeCode: request.params.code,
        revision: set.revision,
        items: publicDeliverables(set.rows),
      },
    };
  };

  const download = (type: DeliverableType) => async (request: FastifyRequest<{ Params: Params; Querystring: DownloadQuery }>) => {
    const data = await signDeliverable(
      pool,
      storage,
      request.params.code,
      type,
      request.params.assetId,
      request.query.disposition === 'preview',
    );
    return { code: 0, data };
  };

  const archive =
    (type: 'drawing' | 'artwork') =>
    async (request: FastifyRequest<{ Params: Params; Querystring: ArchiveQuery }>, reply: FastifyReply) => {
      const result = await buildDeliverableArchive(pool, storage, request.params.code, type, request.query.revision);
      return reply
        .type('application/zip')
        .header('Content-Disposition', `attachment; filename="materials.zip"; filename*=UTF-8''${encodeURIComponent(result.filename)}`)
        .send(result.buffer);
    };

  app.get<{ Params: Params }>(
    '/schemes/:code/drawings',
    {
      onRequest: noStore,
      schema: { tags: ['client-schemes'], params: codeParams },
    },
    list('drawing'),
  );
  app.get<{ Params: Params }>(
    '/schemes/:code/artworks',
    {
      onRequest: noStore,
      schema: { tags: ['client-schemes'], params: codeParams },
    },
    list('artwork'),
  );
  app.get<{ Params: Params; Querystring: ArchiveQuery }>(
    '/schemes/:code/drawings/download',
    {
      onRequest: noStore,
      schema: { tags: ['client-schemes'], summary: '打包下载当前报馆图原件', params: codeParams, querystring: archiveQuery },
    },
    archive('drawing'),
  );
  app.get<{ Params: Params; Querystring: ArchiveQuery }>(
    '/schemes/:code/artworks/download',
    {
      onRequest: noStore,
      schema: { tags: ['client-schemes'], summary: '打包下载当前平面素材原件', params: codeParams, querystring: archiveQuery },
    },
    archive('artwork'),
  );
  app.get<{ Params: Params; Querystring: DownloadQuery }>(
    '/schemes/:code/drawings/:assetId/download',
    {
      onRequest: noStore,
      schema: { tags: ['client-schemes'], params: assetParams, querystring: downloadQuery },
    },
    download('drawing'),
  );
  app.get<{ Params: Params; Querystring: DownloadQuery }>(
    '/schemes/:code/artworks/:assetId/download',
    {
      onRequest: noStore,
      schema: { tags: ['client-schemes'], params: assetParams, querystring: downloadQuery },
    },
    download('artwork'),
  );
  app.get<{ Params: Params; Querystring: DownloadQuery }>(
    '/schemes/:code/model/download',
    {
      onRequest: noStore,
      schema: { tags: ['client-schemes'], params: codeParams, querystring: downloadQuery },
    },
    download('model'),
  );
}
