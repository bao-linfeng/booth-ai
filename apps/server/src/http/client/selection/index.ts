import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Config } from '../../../config.js';
import { createHash } from 'node:crypto';
import type { createStorage } from '../../../infra/storage.js';
import { requirementSchema } from '../../../modules/selection/domain.js';
import { getSelectionCatalog, getSelectionScheme, matchSelection, parseSelection, selectionDependency,
  type MatchSelectionInput, type ParseSelectionInput } from '../../../modules/selection/service.js';
import { getOptionalClientUserId, getVisitorId } from './identity.js';

export async function registerSelectionRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis, storage: ReturnType<typeof createStorage>, config: Config) {
  await app.register(async selection => {
    selection.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const key = `selection:rate:${createHash('sha256').update(request.ip).digest('hex')}:${Math.floor(Date.now() / 60000)}`;
      const count = await selectionDependency(() => redis.eval('local n = redis.call("INCR", KEYS[1]); if n == 1 then redis.call("EXPIRE", KEYS[1], 60) end; return n', 1, key));
      if (Number(count) > 60) {
        reply.header('Retry-After', '60');
        throw Object.assign(new Error('Rate limited'), { statusCode: 429 });
      }
    });

    selection.get('/catalog/options', {
      schema: { tags: ['AI 智选'], summary: '获取智选公共条件' }
    }, async () => {
      return { code: 0, data: await getSelectionCatalog(pool) };
    });

    selection.post<{ Body: ParseSelectionInput }>('/requirements/parse', {
      schema: {
        tags: ['AI 智选'],
        summary: '模型解析需求，失败时规则降级',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'form'],
          properties: {
            attemptId: { type: 'string', format: 'uuid' },
            text: { type: 'string', minLength: 1, maxLength: 1000, pattern: '\\S' },
            form: requirementSchema
          }
        }
      }
    }, async request => {
      const visitorId = getVisitorId(request);
      const userId = await getOptionalClientUserId(pool, redis, request);
      const data = await parseSelection(pool, config, request.body, { visitorId, userId });
      request.log.info({ attemptId: data.attemptId, parseId: data.parseId, degraded: data.degraded }, 'selection parse recorded');
      return { code: 0, data };
    });

    selection.post<{ Body: MatchSelectionInput }>('/scheme-matches', {
      schema: {
        tags: ['AI 智选'],
        summary: '匹配已审核公开方案',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'inputContext', 'requirement'],
          properties: {
            attemptId: { type: 'string', format: 'uuid' },
            parseId: { type: 'string', format: 'uuid' },
            mode: { type: 'string', enum: ['random', 'filtered'] },
            requirement: requirementSchema,
            inputContext: {
              type: 'object',
              additionalProperties: false,
              required: ['textProvided'],
              properties: { textProvided: { type: 'boolean' }, text: { type: 'string', maxLength: 1000 }, degradedParse: { type: 'boolean' } }
            }
          }
        }
      }
    }, async request => {
      const visitorId = getVisitorId(request);
      const userId = await getOptionalClientUserId(pool, redis, request);
      const data = await matchSelection(pool, storage, request.body, { visitorId, userId });

      request.log.info({
        rulesVersion: data.rulesVersion,
        candidateCount: data.diagnostics.ready,
        counts: data.counts,
        diagnostics: data.diagnostics
      }, 'selection completed');

      request.log.info({ attemptId: data.attemptId, searchId: data.searchId }, 'selection search recorded');
      return { code: 0, data };
    });

    selection.get<{ Params: { code: string } }>('/schemes/:code', {
      schema: {
        tags: ['AI 智选'],
        summary: '读取最新公开方案详情',
        params: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 1, maxLength: 200 } }
        }
      }
    }, async request => {
      const { candidate, availability } = await getSelectionScheme(pool, storage, request.params.code);

      return {
        code: 0,
        data: {
          code: candidate.code,
          images: candidate.images,
          specifications: candidate.specifications,
          applicabilityNotes: candidate.applicabilityNotes,
          resources: { model: availability.model, bom: true, renderings: candidate.images.length > 0, masks: candidate.images.length === 3, drawings: availability.drawing, artworks: availability.artwork },
          actions: {
            theme: 'available',
            bom: 'available',
            drawings: availability.drawing ? 'available' : 'unavailable',
            artworks: availability.artwork ? 'available' : 'unavailable',
            quote: 'available',
            modelDownload: availability.model ? 'available' : 'unavailable'
          },
        }
      };
    });
  });
}
