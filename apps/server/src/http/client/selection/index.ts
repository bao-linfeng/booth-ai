import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Config } from '../../../config.js';
import type { createStorage } from '../../../infra/storage.js';
import {
  getSchemeCoverUrl,
  getSelectionCatalog,
  getSelectionScheme,
  matchSelection,
  parseSelection,
} from '../../../modules/selection/service.js';
import { requestMessageLocale } from '../../locale.js';
import { getVisitorId } from './identity.js';
import { rateLimit } from '../../rate-limits.js';
import { catalogRouteSchema, coverRouteSchema, matchRouteSchema, parseRouteSchema, schemeRouteSchema } from './schema.js';

/** 匹配/解析结果里的提示文案跟随 Accept-Language，缺省或不支持的语言回退中文。 */

export async function registerSelectionRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  redis: Redis,
  storage: ReturnType<typeof createStorage>,
  config: Config,
) {
  await app.register(async plugin => {
    const selection = plugin.withTypeProvider<TypeProvider>();
    selection.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      await rateLimit(redis, 'selection')(request, reply);
    });

    selection.get('/catalog/options', { schema: catalogRouteSchema }, async request => {
      const locale = request.query.locale ?? request.headers['accept-language']?.split(',')[0]?.split(';')[0]?.trim() ?? 'zh-CN';
      return { code: 0, data: await getSelectionCatalog(pool, locale) } as const;
    });

    selection.post('/requirements/parse', { schema: parseRouteSchema }, async request => {
      const visitorId = getVisitorId(request);
      const userId = request.principal?.localId ?? null;
      const data = await parseSelection(pool, config, request.body, { visitorId, userId }, requestMessageLocale(request));
      request.log.info({ attemptId: data.attemptId, parseId: data.parseId, degraded: data.degraded }, 'selection parse recorded');
      return { code: 0, data } as const;
    });

    selection.post('/scheme-matches', { schema: matchRouteSchema }, async request => {
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
      return { code: 0, data } as const;
    });

    // 地址固定、每次重新签名，可长期放在 <img> 里（客服会话中的方案卡片）；浏览器缓存短于签名有效期
    selection.get('/schemes/:code/cover', { schema: coverRouteSchema }, async (request, reply) => {
      const url = await getSchemeCoverUrl(pool, storage, request.params.code, 300);
      reply.header('Cache-Control', 'private, max-age=240');
      return reply.redirect(url, 302);
    });

    selection.get('/schemes/:code', { schema: schemeRouteSchema }, async request => {
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
      } as const;
    });
  });
}
