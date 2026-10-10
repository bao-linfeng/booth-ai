import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { getProvidedVisitorId } from '../selection/identity.js';
import { listClientSearches } from '../../../modules/selection/analytics/queries.js';
import { listSearchJobs } from '../../../modules/generation/search-jobs.js';
import { latestVersionKeys } from '../../../modules/assets/queries.js';
import { successResponse } from '../../schemas.js';

type SearchSnapshotItem = {
  code?: unknown;
  matchType?: unknown;
  specifications?: unknown;
  images?: unknown;
};

function asSnapshotItems(snapshot: unknown): SearchSnapshotItem[] {
  return Array.isArray(snapshot) ? snapshot.filter((item): item is SearchSnapshotItem => Boolean(item && typeof item === 'object')) : [];
}

function getFirstImageAssetId(item: SearchSnapshotItem): string | null {
  if (!Array.isArray(item.images)) return null;
  const image = item.images
    .map((image, index) => ({ image, index }))
    .filter((entry): entry is { image: Record<string, unknown>; index: number } => Boolean(entry.image && typeof entry.image === 'object'))
    .sort((left, right) => {
      const leftOrder = typeof left.image.order === 'number' ? left.image.order : left.index;
      const rightOrder = typeof right.image.order === 'number' ? right.image.order : right.index;
      return leftOrder - rightOrder;
    })[0]?.image;
  return typeof image?.assetId === 'string' ? image.assetId : null;
}

const nullableString = { type: ['string', 'null'] } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;
// 检索时冻结的结果快照，字段随智选版本变化，原样返回
const snapshotValue = { description: '检索时冻结的快照字段，原样返回' } as const;
const themeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId', 'status', 'createdAt', 'previewUrl'],
  properties: { jobId: { type: 'string' }, status: { type: 'string' }, createdAt: dateTime, previewUrl: nullableString },
} as const;
const artworkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId', 'status', 'deliveryStatus', 'createdAt', 'views'],
  properties: {
    jobId: { type: 'string' },
    status: { type: 'string' },
    deliveryStatus: { type: 'string' },
    createdAt: dateTime,
    views: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['direction', 'previewUrl'],
        properties: { direction: { type: 'string' }, previewUrl: { type: 'string' } },
      },
    },
  },
} as const;
const searchHistorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'total', 'page', 'pageSize'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'status', 'mode', 'inputText', 'finalRequirement', 'counts', 'items', 'createdAt'],
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          mode: { type: 'string' },
          inputText: { type: 'string' },
          finalRequirement: snapshotValue,
          counts: {
            type: 'object',
            additionalProperties: false,
            required: ['direct', 'reference', 'random', 'total'],
            properties: {
              direct: { type: 'integer' },
              reference: { type: 'integer' },
              random: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['thumbnail', 'theme', 'artwork'],
              properties: {
                code: snapshotValue,
                matchType: snapshotValue,
                specifications: snapshotValue,
                thumbnail: { type: 'string' },
                theme: { anyOf: [themeSchema, { type: 'null' }] },
                artwork: { anyOf: [artworkSchema, { type: 'null' }] },
              },
            },
          },
          createdAt: dateTime,
        },
      },
    },
    total: { type: 'integer' },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
  },
} as const;

export async function registerClientSearchRoutes(app: FastifyInstance, pool: pg.Pool, storage: ReturnType<typeof createStorage>) {
  app.withTypeProvider<TypeProvider>().get(
    '/me/searches',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
        response: { 200: successResponse(searchHistorySchema) },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const userId = request.principal?.localId;
      const visitorId = getProvidedVisitorId(request);
      if (!userId && !visitorId) throw Object.assign(new Error('A valid x-visitor-id header is required'), { statusCode: 400 });
      const page = request.query.page ?? 1;
      const pageSize = request.query.pageSize ?? 20;
      const result = await listClientSearches(pool, userId ? { userId } : { visitorId: visitorId! }, { page, pageSize });
      const snapshotItems = result.data.flatMap(search => asSnapshotItems(search.resultSnapshot));
      const jobs = userId
        ? await listSearchJobs(
            pool,
            storage,
            userId,
            result.data.map(search => search.id),
          )
        : null;
      const assetIds = [...new Set(snapshotItems.map(getFirstImageAssetId).filter((assetId): assetId is string => Boolean(assetId)))];
      const versions = await latestVersionKeys(pool, assetIds);
      const signedUrls = new Map(
        await Promise.all(versions.map(async version => [version.assetId, await storage.signDownload(version.objectKey, 270)] as const)),
      );

      return {
        code: 0 as const,
        data: {
          items: result.data.map(search => ({
            id: search.id,
            status: search.status,
            mode: search.mode,
            inputText: search.inputText,
            finalRequirement: search.finalRequirement,
            counts: { direct: search.directCount, reference: search.referenceCount, random: search.randomCount, total: search.resultCount },
            items: asSnapshotItems(search.resultSnapshot).map(item => ({
              code: item.code,
              matchType: item.matchType,
              specifications: item.specifications,
              thumbnail: signedUrls.get(getFirstImageAssetId(item) ?? '') ?? '',
              theme: typeof item.code === 'string' ? (jobs?.get(search.id)?.get(item.code)?.theme ?? null) : null,
              artwork: typeof item.code === 'string' ? (jobs?.get(search.id)?.get(item.code)?.artwork ?? null) : null,
            })),
            createdAt: search.createdAt,
          })),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
        },
      };
    },
  );
}
