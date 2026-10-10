import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { fileResponse } from '../../bom-schemas.js';
import { successResponse } from '../../schemas.js';
import {
  buildDeliverableArchive,
  getDeliverableSet,
  publicDeliverables,
  signDeliverable,
  type DeliverableType,
} from '../../../modules/assets/deliverables.js';

const code = { type: 'string', minLength: 1, maxLength: 200 } as const;
const codeParams = { type: 'object', required: ['code'], properties: { code } } as const;
const assetParams = {
  type: 'object',
  required: ['code', 'assetId'],
  properties: { code, assetId: { type: 'string', format: 'uuid' } },
} as const;
const downloadQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { disposition: { type: 'string', enum: ['preview', 'attachment'] } },
} as const;
const archiveQuery = {
  type: 'object',
  required: ['revision'],
  additionalProperties: false,
  properties: { revision: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
} as const;

const deliverableListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemeCode', 'revision', 'items'],
  properties: {
    schemeCode: { type: 'string' },
    revision: { type: 'string', description: '当前资料集合的摘要，打包下载时回传以确认内容未变' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['assetId', 'name', 'originalFilename', 'mimeType', 'byteSize', 'sortOrder'],
        properties: {
          assetId: { type: 'string' },
          name: { type: 'string' },
          originalFilename: { type: 'string' },
          mimeType: { type: 'string' },
          byteSize: { type: 'number' },
          sortOrder: { type: 'integer' },
        },
      },
    },
  },
} as const;
const signedDownloadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['downloadUrl', 'filename', 'mimeType', 'expiresAt'],
  properties: {
    downloadUrl: { type: 'string' },
    filename: { type: 'string' },
    mimeType: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
} as const;

export async function registerClientSchemeAssetRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  storage: ReturnType<typeof createStorage>,
): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  const noStore = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.header('Cache-Control', 'no-store');
  };

  for (const [path, type] of [
    ['drawings', 'drawing'],
    ['artworks', 'artwork'],
  ] as const) {
    routes.get(
      `/schemes/:code/${path}`,
      {
        onRequest: noStore,
        schema: { tags: ['client-schemes'], params: codeParams, response: { 200: successResponse(deliverableListSchema) } },
      },
      async request => {
        const set = await getDeliverableSet(pool, request.params.code, type);
        return { code: 0, data: { schemeCode: request.params.code, revision: set.revision, items: publicDeliverables(set.rows) } } as const;
      },
    );
    // 打包下载返回 zip 文件，不走类型化的 JSON 响应
    app.get<{ Params: { code: string }; Querystring: { revision: string } }>(
      `/schemes/:code/${path}/download`,
      {
        onRequest: noStore,
        schema: {
          tags: ['client-schemes'],
          summary: `打包下载当前${type === 'drawing' ? '报馆图' : '平面素材'}原件`,
          params: codeParams,
          querystring: archiveQuery,
          response: fileResponse('zip'),
        },
      },
      async (request, reply) => {
        const result = await buildDeliverableArchive(pool, storage, request.params.code, type, request.query.revision);
        return reply
          .type('application/zip')
          .header('Content-Disposition', `attachment; filename="materials.zip"; filename*=UTF-8''${encodeURIComponent(result.filename)}`)
          .send(result.buffer);
      },
    );
  }

  const download = (path: string, type: DeliverableType, params: typeof codeParams | typeof assetParams) =>
    routes.get(
      path,
      {
        onRequest: noStore,
        schema: { tags: ['client-schemes'], params, querystring: downloadQuery, response: { 200: successResponse(signedDownloadSchema) } },
      },
      async request => {
        const { assetId } = request.params as { assetId?: string };
        const data = await signDeliverable(pool, storage, request.params.code, type, assetId, request.query.disposition === 'preview');
        return { code: 0, data } as const;
      },
    );
  download('/schemes/:code/drawings/:assetId/download', 'drawing', assetParams);
  download('/schemes/:code/artworks/:assetId/download', 'artwork', assetParams);
  download('/schemes/:code/model/download', 'model', codeParams);
}
