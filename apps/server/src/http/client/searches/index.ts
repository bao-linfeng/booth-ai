import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { createStorage } from '../../../infra/storage.js';
import { clientUserId } from '../../authentication.js';
import { listUserSearches } from '../../../modules/selection-analytics/queries.js';
import { listSearchJobs } from '../../../modules/generation/search-jobs.js';

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

export async function registerClientSearchRoutes(app: FastifyInstance, pool: pg.Pool, _redis: Redis, storage: ReturnType<typeof createStorage>) {
  app.get<{ Querystring: { page?: number; pageSize?: number } }>('/me/searches', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = clientUserId(request);
    const page = request.query.page ?? 1;
    const pageSize = request.query.pageSize ?? 20;
    const result = await listUserSearches(pool, userId, { page, pageSize });
    const snapshotItems = result.data.flatMap(search => asSnapshotItems(search.resultSnapshot));
    const jobs = await listSearchJobs(pool, storage, userId, result.data.map(search => search.id));
    const assetIds = [...new Set(snapshotItems.map(getFirstImageAssetId).filter((assetId): assetId is string => Boolean(assetId)))];
    const versions = assetIds.length === 0 ? [] : (await pool.query<{ assetId: string; objectKey: string }>(
      `SELECT DISTINCT ON (v.asset_id) v.asset_id::text AS "assetId",v.object_key AS "objectKey"
       FROM asset_versions v
       WHERE v.asset_id::text = ANY($1::text[])
       ORDER BY v.asset_id,v.created_at DESC,v.id DESC`,
      [assetIds],
    )).rows;
    const signedUrls = new Map(await Promise.all(versions.map(async version => [version.assetId, await storage.signDownload(version.objectKey, 270)] as const)));

    return {
      code: 0,
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
            theme: typeof item.code === 'string' ? jobs.get(search.id)?.get(item.code)?.theme ?? null : null,
            artwork: typeof item.code === 'string' ? jobs.get(search.id)?.get(item.code)?.artwork ?? null : null,
          })),
          createdAt: search.createdAt,
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  });
}
