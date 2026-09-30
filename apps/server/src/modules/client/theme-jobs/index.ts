import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { listAiModels } from '../../../infra/ai-models.js';
import { transaction } from '../../../infra/database.js';
import { getSession } from '../../../infra/session.js';

const OFFER_TTL_SECONDS = 300; // 5 minutes

async function requireClientSession(authorization: string | undefined, redis: Redis): Promise<string> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
  const session = token ? await getSession(redis, token, 'client') : null;
  if (!session) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  return session.localId;
}

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

export async function registerThemeModelRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis) {
  app.get('/theme-models', { schema: { tags: ['AI 换主题'], summary: '可选择的图像模型及每张图积分' } }, async () => {
    const models = (await listAiModels(pool)).filter(model => model.purpose === 'theme' && model.enabled &&
      model.credentialConfigured && model.unitCredits !== null);
    return { code: 0, data: models.map(({ provider, model, unitCredits, revision }) => ({ provider, model, unitCredits, revision })) };
  });

  app.post<{
    Body: {
      schemeCode: string;
      sourceAssetId: string;
      input?: { industryId: string; styleId: string; brandColors?: string[]; brandKeywords?: string };
      requestedCount?: number;
      cacheMode?: string;
    };
  }>('/theme-offers', {
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
        },
      },
    },
  }, async request => {
    await requireClientSession(request.headers.authorization, redis);

    // Check if any enabled theme model with credentials is available
    const allModels = await listAiModels(pool);
    const availableModels = allModels.filter(m => m.purpose === 'theme' && m.enabled && m.credentialConfigured && m.unitCredits !== null);
    const available = availableModels.length > 0;

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
      // Pick the highest-priority model for pricing
      const primaryModel = availableModels.sort((a, b) => a.priority - b.priority)[0]!;
      const unitCredits = primaryModel.unitCredits!;
      const offerId = randomUUID();
      const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000).toISOString();
      const offerData = {
        schemeCode: request.body.schemeCode,
        sourceAssetId: request.body.sourceAssetId,
        industryId: input.industryId,
        styleId: input.styleId,
        requestedCount,
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
        maxCredits: unitCredits * requestedCount,
        settlementRule: 'per_usable_image',
        cacheHit: false,
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
      cacheMode?: string;
    };
  }>('/theme-jobs', {
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
        },
      },
    },
  }, async (request, reply) => {
    const userId = await requireClientSession(request.headers.authorization, redis);
    const { requestKey, offerId, schemeCode, sourceAssetId, input, requestedCount, cacheMode = 'reuse' } = request.body;

    // Verify offer exists in Redis
    const offerRaw = await redis.get(`theme-offer:${offerId}`);
    if (!offerRaw) {
      reply.status(409);
      return { error: { code: 'REQUEST_ERROR', reason: 'OFFER_EXPIRED', message: 'Offer expired or not found', requestId: request.id } };
    }
    const offerData = JSON.parse(offerRaw) as { unitCredits: number; pricingRevision: number };
    const unitCredits = offerData.unitCredits;

    // Check idempotency: same user + requestKey
    const existing = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM theme_jobs WHERE user_id = $1 AND request_key = $2`,
      [userId, requestKey]
    );
    if (existing.rows[0]) {
      const job = existing.rows[0];
      return {
        code: 0,
        data: {
          jobId: job.id,
          status: job.status,
          reusedRequest: true,
          cacheHit: false,
          credits: { status: 'pending', reservedCredits: 0, chargedCredits: 0, releasedCredits: 0 },
          pollAfterMs: 2000,
        },
      };
    }

    // Create the job and its outbox record atomically.
    const jobId = await transaction(pool, async client => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO theme_jobs
           (user_id, scheme_code, source_asset_id, offer_id, request_key, input, requested_count, cache_mode, status, unit_credits)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
         RETURNING id`,
        [userId, schemeCode, sourceAssetId, offerId, requestKey, JSON.stringify(input), requestedCount, cacheMode, unitCredits]
      );
      const jobId = result.rows[0]?.id;
      if (!jobId) throw new Error('Failed to create theme job');

      await client.query(
        `INSERT INTO theme_job_outbox (job_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [jobId]
      );
      return jobId;
    });

    reply.status(202);
    return {
      code: 0,
      data: {
        jobId,
        status: 'pending',
        reusedRequest: false,
        cacheHit: false,
        credits: { status: 'pending', reservedCredits: unitCredits * requestedCount, chargedCredits: 0, releasedCredits: 0 },
        pollAfterMs: 2000,
      },
    };
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
    const userId = await requireClientSession(request.headers.authorization, redis);
    const { jobId } = request.params;

    const result = await pool.query<{
      id: string; schemeCode: string; sourceAssetId: string; status: string; phase: string | null;
      requestedCount: number; usableCount: number; selectedResultId: string | null;
      selectionRevision: number; unitCredits: number | null; input: unknown;
      createdAt: string; updatedAt: string;
    }>(
      `SELECT id, scheme_code AS "schemeCode", source_asset_id AS "sourceAssetId", status, phase,
              requested_count AS "requestedCount", usable_count AS "usableCount",
              selected_result_id AS "selectedResultId", selection_revision AS "selectionRevision",
              unit_credits AS "unitCredits", input, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM theme_jobs WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );

    const job = result.rows[0];
    if (!job) throw Object.assign(new Error('Theme job not found'), { statusCode: 404 });

    const resultsQ = await pool.query<{
      id: string; ordinal: number; assetId: string; previewUrl: string | null; width: number | null; height: number | null;
    }>(
      `SELECT id, ordinal, asset_id AS "assetId", preview_url AS "previewUrl", width, height
       FROM theme_job_results WHERE job_id = $1 ORDER BY ordinal`,
      [jobId]
    );
    const results = resultsQ.rows.map(r => ({
      resultId: r.id,
      previewUrl: r.previewUrl ?? '',
      width: r.width ?? 0,
      height: r.height ?? 0,
    }));

    const unitCredits = job.unitCredits ?? 0;
    const isTerminal = ['succeeded', 'partially_succeeded', 'failed'].includes(job.status);

    return {
      code: 0,
      data: {
        jobId: job.id,
        schemeCode: job.schemeCode,
        status: job.status,
        phase: job.phase,
        requestedCount: job.requestedCount,
        usableCount: job.usableCount,
        original: { assetId: job.sourceAssetId, previewUrl: null },
        results,
        selection: { resultId: job.selectedResultId, revision: job.selectionRevision },
        credits: {
          status: job.status === 'pending' ? 'pending' : job.status === 'failed' ? 'released' : 'settled',
          reservedCredits: unitCredits * job.requestedCount,
          chargedCredits: unitCredits * job.usableCount,
          releasedCredits: unitCredits * (job.requestedCount - job.usableCount),
        },
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
    async (request, reply) => {
      const userId = await requireClientSession(request.headers.authorization, redis);
      const { jobId } = request.params;
      const { resultId, expectedRevision } = request.body;

      const jobQ = await pool.query<{
        id: string; schemeCode: string; status: string;
        selectedResultId: string | null; selectionRevision: number;
      }>(
        `SELECT id, scheme_code AS "schemeCode", status, selected_result_id AS "selectedResultId", selection_revision AS "selectionRevision"
         FROM theme_jobs WHERE id = $1 AND user_id = $2`,
        [jobId, userId]
      );
      const job = jobQ.rows[0];
      if (!job) {
        reply.status(404);
        return { error: { code: 'REQUEST_ERROR', reason: 'RESOURCE_NOT_FOUND', message: 'Theme job not found', requestId: request.id } };
      }
      if (!['succeeded', 'partially_succeeded'].includes(job.status)) {
        reply.status(409);
        return { error: { code: 'REQUEST_ERROR', reason: 'OPERATION_FORBIDDEN', message: 'Job is not in a succeeded state', requestId: request.id } };
      }

      if (job.selectedResultId === resultId) {
        return {
          code: 0,
          data: { jobId, schemeCode: job.schemeCode, resultId, revision: job.selectionRevision, selectedAt: new Date().toISOString() },
        };
      }

      if (job.selectionRevision !== expectedRevision) {
        reply.status(409);
        return { error: { code: 'REQUEST_ERROR', reason: 'SELECTION_CONFLICT', message: 'Selection revision conflict', requestId: request.id } };
      }

      const resultQ = await pool.query<{ id: string }>(
        `SELECT id FROM theme_job_results WHERE id = $1 AND job_id = $2`,
        [resultId, jobId]
      );
      if (!resultQ.rows[0]) {
        reply.status(404);
        return { error: { code: 'REQUEST_ERROR', reason: 'RESOURCE_NOT_FOUND', message: 'Result not found', requestId: request.id } };
      }

      const updated = await pool.query<{ selectionRevision: number; updatedAt: string }>(
        `UPDATE theme_jobs
         SET selected_result_id = $1, selection_revision = selection_revision + 1, updated_at = now()
         WHERE id = $2 AND user_id = $3 AND selection_revision = $4
         RETURNING selection_revision AS "selectionRevision", updated_at AS "updatedAt"`,
        [resultId, jobId, userId, expectedRevision]
      );
      if (!updated.rows[0]) {
        reply.status(409);
        return { error: { code: 'REQUEST_ERROR', reason: 'SELECTION_CONFLICT', message: 'Concurrent selection conflict', requestId: request.id } };
      }
      return {
        code: 0,
        data: {
          jobId,
          schemeCode: job.schemeCode,
          resultId,
          revision: updated.rows[0].selectionRevision,
          selectedAt: updated.rows[0].updatedAt,
        },
      };
    }
  );
}
