import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { assignedAiModels } from '../../../infra/ai/config.js';
import { clientUserId, requirePrincipal } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import type { createStorage } from '../../../infra/storage.js';
import { streamThemeJobEvents } from './events.js';
import { getThemeJob, ownedThemeJob, selectThemeResult } from '../../../modules/generation/theme/queries.js';
import { assertThemeSearch, createThemeJob, findCachedThemeJob, loadGenerationSnapshot, normalizeThemeInput, replayThemeRequest,
  themeCacheKey, themeCredits, type ThemeOfferData } from '../../../modules/generation/theme/service.js';

const OFFER_TTL_SECONDS = 300; // 5 minutes

async function loadDictionaryOptions(pool: pg.Pool): Promise<{ industries: { id: string; label: string }[]; styles: { id: string; label: string }[] }> {
  const result = await pool.query<{ type: string; id: string; label: string }>(
    `SELECT d.code AS type, i.id::text AS id, i.item_label AS label
     FROM dictionaries d JOIN dictionary_items i ON i.dictionary_id = d.id
     WHERE d.enabled AND i.enabled AND d.code IN ('industry', 'style')
     ORDER BY d.code, i.sort_order, i.id`
  );
  return {
    industries: result.rows.filter(r => r.type === 'industry').map(({ id, label }) => ({ id, label })),
    styles: result.rows.filter(r => r.type === 'style').map(({ id, label }) => ({ id, label })),
  };
}

export async function registerThemeModelRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis, storage: ReturnType<typeof createStorage>) {
  app.post<{ Params: { jobId: string } }>('/theme-jobs/:jobId/events-ticket', async request => {
    const userId = clientUserId(request);
    await ownedThemeJob(pool, userId, request.params.jobId);
    const ticket = randomUUID();
    await redis.set(`theme-events-ticket:${ticket}`, JSON.stringify({ jobId: request.params.jobId, userId, token: requirePrincipal(request, 'client').token }), 'EX', 300);
    return { code: 0, data: { ticket } };
  });

  app.get<{ Params: { jobId: string }; Querystring: { ticket: string } }>('/theme-jobs/:jobId/events', {
    config: { authentication: 'events', eventTicketPrefix: 'theme' },
    schema: { querystring: { type: 'object', required: ['ticket'], additionalProperties: false, properties: { ticket: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    const userId = clientUserId(request);
    await ownedThemeJob(pool, userId, request.params.jobId);
    await streamThemeJobEvents(pool, redis, request.params.jobId, userId, reply);
  });

  app.get('/theme-models', { schema: { tags: ['AI 换主题'], summary: '可选择的图像模型及每张图积分' } }, async () => {
    const models = await assignedAiModels(pool, 'theme');
    return { code: 0, data: models.map(({ id, name, unitCredits, revision }) => ({ id, name, unitCredits, revision })) };
  });

  app.post<{
    Body: {
      schemeCode: string;
      sourceAssetId: string;
      input?: { industryId: string; styleId: string; brandColors?: string[]; brandKeywords?: string };
      requestedCount?: number;
      cacheMode?: 'reuse' | 'refresh';
      searchId?: string;
    };
  }>('/theme-offers', {
    preHandler: rateLimit(redis, 'generation'),
    schema: {
      tags: ['AI 换主题'],
      summary: '获取可生成能力及费用提议（API-092）',
      body: {
        type: 'object',
        required: ['schemeCode', 'sourceAssetId'],
        additionalProperties: false,
        properties: {
          schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
          sourceAssetId: { type: 'string', minLength: 1, maxLength: 200 },
          input: {
            type: 'object',
            required: ['industryId', 'styleId'],
            additionalProperties: false,
            properties: {
              industryId: { type: 'string', minLength: 1, maxLength: 200 },
              styleId: { type: 'string', minLength: 1, maxLength: 200 },
              brandColors: { type: 'array', maxItems: 3, items: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
              brandKeywords: { type: 'string', maxLength: 200 },
            },
          },
          requestedCount: { type: 'integer', minimum: 1, maximum: 4 },
          cacheMode: { type: 'string', enum: ['reuse', 'refresh'] },
          searchId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async request => {
    const userId = clientUserId(request);

    const available = (await assignedAiModels(pool, 'theme')).length > 0;

    const blockedReasons: string[] = [];
    if (!available) blockedReasons.push('MODEL_UNAVAILABLE');

    const { industries, styles } = await loadDictionaryOptions(pool);

    // Full cartesian product as supportedCombinations
    const supportedCombinations = industries.flatMap(ind =>
      styles.map(sty => ({ industryId: ind.id, styleId: sty.id }))
    );

    const limits = { maxBrandColors: 3, maxKeywordCharacters: 200, allowedCounts: [1, 2, 3, 4] };

    const { input, requestedCount = 1 } = request.body;
    let offer: {
      id: string;
      expiresAt: string;
      pricingRevision: number;
      unitCredits: number;
      maxCredits: number;
      settlementRule: string;
      cacheHit: boolean;
    } | null = null;

    if (available && input?.industryId && input?.styleId) {
      const parameters = { schemeCode: request.body.schemeCode, sourceAssetId: request.body.sourceAssetId,
        input: normalizeThemeInput(input), requestedCount, cacheMode: request.body.cacheMode ?? 'reuse', searchId: request.body.searchId };
      await assertThemeSearch(pool, userId, parameters);
      const snapshot = await loadGenerationSnapshot(pool, parameters);
      const cacheKey = themeCacheKey(userId, parameters, snapshot);
      const cacheHit = parameters.cacheMode === 'reuse' && Boolean(await findCachedThemeJob(pool, userId, cacheKey, requestedCount));
      const primaryModel = snapshot.models[0]!;
      const unitCredits = primaryModel.unitCredits!;
      const offerId = randomUUID();
      const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000).toISOString();
      const offerData: ThemeOfferData = {
        ...parameters, userId, cacheKey, snapshot, cacheHit,
        unitCredits,
        expiresAt,
        pricingRevision: primaryModel.revision,
      };
      await redis.set(`theme-offer:${offerId}`, JSON.stringify(offerData), 'EX', OFFER_TTL_SECONDS);
      offer = {
        id: offerId,
        expiresAt,
        pricingRevision: primaryModel.revision,
        unitCredits,
        maxCredits: cacheHit ? 0 : unitCredits * requestedCount,
        settlementRule: 'per_usable_image',
        cacheHit,
      };
    }

    return {
      code: 0,
      data: { available, blockedReasons, limits, supportedCombinations, offer },
    };
  });

  // POST /theme-jobs — 创建生成任务（API-006）
  app.post<{
    Body: {
      requestKey: string;
      offerId: string;
      schemeCode: string;
      sourceAssetId: string;
      input: { industryId: string; styleId: string; brandColors?: string[]; brandKeywords?: string };
      requestedCount: number;
      cacheMode?: 'reuse' | 'refresh';
      searchId?: string;
    };
  }>('/theme-jobs', {
    preHandler: rateLimit(redis, 'generation'),
    schema: {
      tags: ['AI 换主题'],
      summary: '创建换主题生成任务（API-006）',
      body: {
        type: 'object',
        required: ['requestKey', 'offerId', 'schemeCode', 'sourceAssetId', 'input', 'requestedCount'],
        additionalProperties: false,
        properties: {
          requestKey: { type: 'string', format: 'uuid' },
          offerId: { type: 'string', minLength: 1 },
          schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
          sourceAssetId: { type: 'string', minLength: 1, maxLength: 200 },
          input: {
            type: 'object',
            required: ['industryId', 'styleId'],
            additionalProperties: false,
            properties: {
              industryId: { type: 'string', minLength: 1, maxLength: 200 },
              styleId: { type: 'string', minLength: 1, maxLength: 200 },
              brandColors: { type: 'array', maxItems: 3, items: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
              brandKeywords: { type: 'string', maxLength: 200 },
            },
          },
          requestedCount: { type: 'integer', minimum: 1, maximum: 4 },
          cacheMode: { type: 'string', enum: ['reuse', 'refresh'] },
          searchId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const userId = clientUserId(request);
    const { requestKey, offerId, schemeCode, sourceAssetId, input, requestedCount, cacheMode = 'reuse', searchId } = request.body;

    const parameters = { schemeCode, sourceAssetId, input: normalizeThemeInput(input), requestedCount, cacheMode, searchId };
    const replay = await replayThemeRequest(pool, userId, requestKey, parameters);
    if (replay) {
      reply.header('Location', `/api/v1/client/theme-jobs/${replay.jobId}`);
      return { code: 0, data: replay };
    }

    const offerRaw = await redis.get(`theme-offer:${offerId}`);
    if (!offerRaw) {
      reply.status(409);
      return { error: { code: 'REQUEST_ERROR', reason: 'OFFER_EXPIRED', message: 'Offer expired or not found', requestId: request.id } };
    }
    const data = await createThemeJob(pool, userId, requestKey, offerId, parameters, JSON.parse(offerRaw) as ThemeOfferData, request.id);
    if (!data.reusedRequest) request.log.info({ jobKind: 'theme', jobId: data.jobId, cacheHit: data.cacheHit }, 'generation job accepted');
    reply.status(data.cacheHit || data.reusedRequest ? 200 : 202);
    reply.header('Location', `/api/v1/client/theme-jobs/${data.jobId}`);
    return { code: 0, data };
  });

  // GET /theme-jobs/:jobId — 查询任务状态（API-007）
  app.get<{ Params: { jobId: string } }>('/theme-jobs/:jobId', {
    schema: {
      tags: ['AI 换主题'],
      summary: '查询换主题任务状态（API-007）',
      params: {
        type: 'object',
        required: ['jobId'],
        properties: { jobId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async request => {
    const userId = clientUserId(request);
    const { jobId } = request.params;

    const { job, results: rows } = await getThemeJob(pool, userId, jobId);
    const results = await Promise.all(rows.map(async r => ({
      resultId: r.id,
      previewUrl: await storage.signDownload(r.objectKey, 900),
      width: r.width ?? 0,
      height: r.height ?? 0,
    })));

    const isTerminal = ['succeeded', 'partially_succeeded', 'failed'].includes(job.status);

     const originalPreviewUrl = job.sourceObjectKey ? await storage.signDownload(job.sourceObjectKey, 900) : null;

     return {
      code: 0,
      data: {
        jobId: job.id,
        schemeCode: job.schemeCode,
        searchId: job.searchId,
        status: job.status,
        phase: job.phase,
        requestedCount: job.requestedCount,
        usableCount: job.usableCount,
        cacheHit: job.cacheHit,
         original: { assetId: job.sourceAssetId, previewUrl: originalPreviewUrl },
        results,
        selection: { resultId: job.selectedResultId, revision: job.selectionRevision },
        credits: themeCredits(job),
        failure: job.status === 'failed' ? { reason: 'GENERATION_FAILED', retryable: true } : null,
        pollAfterMs: isTerminal ? null : 2000,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    };
  });

  // PUT /theme-jobs/:jobId/selection — 保存最终效果（API-008）
  app.put<{ Params: { jobId: string }; Body: { resultId: string; expectedRevision: number } }>(
    '/theme-jobs/:jobId/selection',
    {
      schema: {
        tags: ['AI 换主题'],
        summary: '保存最终效果选择（API-008）',
        params: {
          type: 'object',
          required: ['jobId'],
          properties: { jobId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['resultId', 'expectedRevision'],
          additionalProperties: false,
          properties: {
            resultId: { type: 'string', format: 'uuid' },
            expectedRevision: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async request => {
      const userId = clientUserId(request);
      const { jobId } = request.params;
      const { resultId, expectedRevision } = request.body;

      return { code: 0, data: await selectThemeResult(pool, userId, jobId, resultId, expectedRevision) };
    }
  );
}
