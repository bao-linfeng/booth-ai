import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Config } from '../../../config.js';
import type { createStorage } from '../../../infra/storage.js';
import { requirementSchema } from '../../../modules/selection/domain.js';
import {
  getSchemeCoverUrl,
  getSelectionCatalog,
  getSelectionScheme,
  matchSelection,
  parseSelection,
  type MatchSelectionInput,
  type ParseSelectionInput,
} from '../../../modules/selection/service.js';
import { requestMessageLocale } from '../../locale.js';
import { getVisitorId } from './identity.js';
import { rateLimit } from '../../rate-limits.js';

/** 匹配/解析结果里的提示文案跟随 Accept-Language，缺省或不支持的语言回退中文。 */

export async function registerSelectionRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  redis: Redis,
  storage: ReturnType<typeof createStorage>,
  config: Config,
) {
  await app.register(async selection => {
    selection.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      await rateLimit(redis, 'selection')(request, reply);
    });

    selection.get(
      '/catalog/options',
      {
        schema: {
          tags: ['AI 智选'],
          summary: '获取智选公共条件',
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: { locale: { type: 'string', pattern: '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$', maxLength: 35 } },
          },
        },
      },
      async request => {
        const locale =
          (request.query as { locale?: string }).locale ??
          request.headers['accept-language']?.split(',')[0]?.split(';')[0]?.trim() ??
          'zh-CN';
        return { code: 0, data: await getSelectionCatalog(pool, locale) };
      },
    );

    selection.post<{ Body: ParseSelectionInput }>(
      '/requirements/parse',
      {
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
              form: requirementSchema,
            },
          },
        },
      },
      async request => {
        const visitorId = getVisitorId(request);
        const userId = request.principal?.localId ?? null;
        const data = await parseSelection(pool, config, request.body, { visitorId, userId }, requestMessageLocale(request));
        request.log.info({ attemptId: data.attemptId, parseId: data.parseId, degraded: data.degraded }, 'selection parse recorded');
        return { code: 0, data };
      },
    );

    selection.post<{ Body: MatchSelectionInput }>(
      '/scheme-matches',
      {
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
                properties: {
                  textProvided: { type: 'boolean' },
                  text: { type: 'string', maxLength: 1000 },
                  degradedParse: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      async request => {
        const visitorId = getVisitorId(request);
        const userId = request.principal?.localId ?? null;
        const data = await matchSelection(pool, storage, request.body, { visitorId, userId }, requestMessageLocale(request));

        request.log.info(
          {
            rulesVersion: data.rulesVersion,
            candidateCount: data.diagnostics.ready,
            counts: data.counts,
            diagnostics: data.diagnostics,
          },
          'selection completed',
        );

        request.log.info({ attemptId: data.attemptId, searchId: data.searchId }, 'selection search recorded');
        return { code: 0, data };
      },
    );

    // 地址固定、每次重新签名，可长期放在 <img> 里（客服会话中的方案卡片）；浏览器缓存短于签名有效期
    selection.get<{ Params: { code: string } }>(
      '/schemes/:code/cover',
      {
        schema: {
          tags: ['AI 智选'],
          summary: '方案封面图（302 跳转到第一张效果图的短时签名地址）',
          params: {
            type: 'object',
            required: ['code'],
            properties: { code: { type: 'string', minLength: 1, maxLength: 200 } },
          },
        },
      },
      async (request, reply) => {
        const url = await getSchemeCoverUrl(pool, storage, request.params.code, 300);
        reply.header('Cache-Control', 'private, max-age=240');
        return reply.redirect(url, 302);
      },
    );

    selection.get<{ Params: { code: string } }>(
      '/schemes/:code',
      {
        schema: {
          tags: ['AI 智选'],
          summary: '读取最新公开方案详情',
          params: {
            type: 'object',
            required: ['code'],
            properties: { code: { type: 'string', minLength: 1, maxLength: 200 } },
          },
        },
      },
      async request => {
        const { candidate, availability } = await getSelectionScheme(pool, storage, request.params.code);

        return {
          code: 0,
          data: {
            code: candidate.code,
            images: candidate.images,
            specifications: candidate.specifications,
            description: candidate.description,
            resources: {
              model: availability.model,
              bom: true,
              renderings: candidate.images.length > 0,
              masks: candidate.images.length === 3,
              drawings: availability.drawing,
              artworks: availability.artwork,
            },
            actions: {
              theme: 'available',
              bom: 'available',
              drawings: availability.drawing ? 'available' : 'unavailable',
              artworks: availability.artwork ? 'available' : 'unavailable',
              quote: 'available',
              modelDownload: availability.model ? 'available' : 'unavailable',
            },
          },
        };
      },
    );
  });
}
