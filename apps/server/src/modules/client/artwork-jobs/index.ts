import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { listAiModels } from '../../../infra/ai-models.js';
import { transaction } from '../../../infra/database.js';
import { getSession } from '../../../infra/session.js';
import type { createStorage } from '../../../infra/storage.js';

const OFFER_TTL_SECONDS = 300;
const ARTWORK_KEYS = ['front', 'back', 'left', 'right'] as const;
type ArtworkKey = typeof ARTWORK_KEYS[number];

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
     ORDER BY d.code, i.sort_order, i.id`,
  );
  return {
    industries: result.rows.filter(r => r.type === 'industry').map(({ id, label }) => ({ id, label })),
    styles: result.rows.filter(r => r.type === 'style').map(({ id, label }) => ({ id, label })),
  };
}

export async function registerArtworkJobRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  redis: Redis,
  storage: ReturnType<typeof createStorage>,
) {
  // GET /artwork-models — 可用模型及积分
  app.get('/artwork-models', {
    schema: { tags: ['AI 平面素材'], summary: '可选择的图像模型及每张图积分' },
  }, async () => {
    const models = (await listAiModels(pool)).filter(
      model => model.purpose === 'artwork' && model.enabled && model.credentialConfigured && model.unitCredits !== null,
    );
    return { code: 0, data: models.map(({ provider, model, unitCredits, revision }) => ({ provider, model, unitCredits, revision })) };
  });

  // POST /artwork-offers — 获取能力及费用提议
  app.post<{
    Body: {
      schemeCode: string;
      sourceAssetId: string;
      artworkKey: ArtworkKey;
      input?: { industryId: string; styleId: string; brandColors?: string[]; brandKeywords?: string };
      requestedCount?: number;
    };
  }>('/artwork-offers', {
    schema: {
      tags: ['AI 平面素材'],
      summary: '获取可生成能力及费用提议',
      body: {
        type: 'object',
        required: ['schemeCode', 'sourceAssetId', 'artworkKey'],
        additionalProperties: false,
        properties: {
          schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
          sourceAssetId: { type: 'string', format: 'uuid' },
          artworkKey: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
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
        },
      },
    },
  }, async request => {
    await requireClientSession(request.headers.authorization, redis);

    const allModels = await listAiModels(pool);
    const availableModels = allModels.filter(
      m => m.purpose === 'artwork' && m.enabled && m.credentialConfigured && m.unitCredits !== null,
    );
    const available = availableModels.length > 0;
    const blockedReasons: string[] = [];
    if (!available) blockedReasons.push('MODEL_UNAVAILABLE');

    const { industries, styles } = await loadDictionaryOptions(pool);
    const supportedCombinations = industries.flatMap(ind => styles.map(sty => ({ industryId: ind.id, styleId: sty.id })));
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
      const primaryModel = availableModels.sort((a, b) => a.priority - b.priority)[0]!;
      const unitCredits = primaryModel.unitCredits!;
      const offerId = randomUUID();
      const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000).toISOString();
      const offerData = {
        schemeCode: request.body.schemeCode,
        sourceAssetId: request.body.sourceAssetId,
        artworkKey: request.body.artworkKey,
        industryId: input.industryId,
        styleId: input.styleId,
        requestedCount,
        unitCredits,
        expiresAt,
        pricingRevision: primaryModel.revision,
      };
      await redis.set(`artwork-offer:${offerId}`, JSON.stringify(offerData), 'EX', OFFER_TTL_SECONDS);
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

    return { code: 0, data: { available, blockedReasons, limits, supportedCombinations, offer } };
  });

  // POST /artwork-jobs — 创建生成任务
  app.post<{
    Body: {
      requestKey: string;
      offerId: string;
      schemeCode: string;
      sourceAssetId: string;
      artworkKey: ArtworkKey;
      input: { industryId: string; styleId: string; brandColors?: string[]; brandKeywords?: string };
      requestedCount: number;
      cacheMode?: string;
    };
  }>('/artwork-jobs', {
    schema: {
      tags: ['AI 平面素材'],
      summary: '创建平面素材生成任务',
      body: {
        type: 'object',
        required: ['requestKey', 'offerId', 'schemeCode', 'sourceAssetId', 'artworkKey', 'input', 'requestedCount'],
        additionalProperties: false,
        properties: {
          requestKey: { type: 'string', format: 'uuid' },
          offerId: { type: 'string', minLength: 1 },
          schemeCode: { type: 'string', minLength: 1, maxLength: 200 },
          sourceAssetId: { type: 'string', format: 'uuid' },
          artworkKey: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
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
    const { requestKey, offerId, schemeCode, sourceAssetId, artworkKey, input, requestedCount, cacheMode = 'reuse' } = request.body;

    const offerRaw = await redis.get(`artwork-offer:${offerId}`);
    if (!offerRaw) {
      reply.status(409);
      return { error: { code: 'REQUEST_ERROR', reason: 'OFFER_EXPIRED', message: 'Offer expired or not found', requestId: request.id } };
    }
    const offerData = JSON.parse(offerRaw) as { unitCredits: number; pricingRevision: number };
    const unitCredits = offerData.unitCredits;

    const existing = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM artwork_jobs WHERE user_id = $1 AND request_key = $2`,
      [userId, requestKey],
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

    const jobId = await transaction(pool, async client => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO artwork_jobs
           (user_id, scheme_code, source_asset_id, artwork_key, offer_id, request_key, input, requested_count, cache_mode, status, unit_credits)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)
         RETURNING id`,
        [userId, schemeCode, sourceAssetId, artworkKey, offerId, requestKey, JSON.stringify(input), requestedCount, cacheMode, unitCredits],
      );
      const jobId = result.rows[0]?.id;
      if (!jobId) throw new Error('Failed to create artwork job');
      await client.query(
        `INSERT INTO artwork_job_outbox (job_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [jobId],
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

  // GET /artwork-jobs/:jobId — 查询任务状态
  app.get<{ Params: { jobId: string } }>('/artwork-jobs/:jobId', {
    schema: {
      tags: ['AI 平面素材'],
      summary: '查询平面素材生成任务状态',
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
      id: string;
      schemeCode: string;
      sourceAssetId: string;
      sourceObjectKey: string | null;
      artworkKey: string;
      status: string;
      phase: string | null;
      requestedCount: number;
      usableCount: number;
      selectedResultId: string | null;
      selectionRevision: number;
      unitCredits: number | null;
      input: unknown;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, scheme_code AS "schemeCode", source_asset_id AS "sourceAssetId",
              (SELECT av.object_key FROM asset_versions av WHERE av.asset_id = source_asset_id ORDER BY av.created_at DESC, av.id DESC LIMIT 1) AS "sourceObjectKey",
              artwork_key AS "artworkKey", status, phase,
              requested_count AS "requestedCount", usable_count AS "usableCount",
              selected_result_id AS "selectedResultId", selection_revision AS "selectionRevision",
              unit_credits AS "unitCredits", input, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM artwork_jobs WHERE id = $1 AND user_id = $2`,
      [jobId, userId],
    );
    const job = result.rows[0];
    if (!job) throw Object.assign(new Error('Artwork job not found'), { statusCode: 404 });

    const resultsQ = await pool.query<{ id: string; ordinal: number; width: number | null; height: number | null; objectKey: string }>(
      `SELECT ajr.id, ajr.ordinal, ajr.width, ajr.height, av.object_key AS "objectKey"
       FROM artwork_job_results ajr
       JOIN scheme_assets sa ON sa.id = ajr.asset_id
       JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = sa.id ORDER BY created_at DESC, id DESC LIMIT 1) av ON true
       WHERE ajr.job_id = $1 ORDER BY ajr.ordinal`,
      [jobId],
    );
    const results = await Promise.all(
      resultsQ.rows.map(async r => ({
        resultId: r.id,
        previewUrl: await storage.signDownload(r.objectKey, 900),
        width: r.width ?? 0,
        height: r.height ?? 0,
      })),
    );

    const unitCredits = job.unitCredits ?? 0;
    const isTerminal = ['succeeded', 'partially_succeeded', 'failed'].includes(job.status);
    const originalPreviewUrl = job.sourceObjectKey ? await storage.signDownload(job.sourceObjectKey, 900) : null;

    return {
      code: 0,
      data: {
        jobId: job.id,
        schemeCode: job.schemeCode,
        artworkKey: job.artworkKey,
        status: job.status,
        phase: job.phase,
        requestedCount: job.requestedCount,
        usableCount: job.usableCount,
        original: { assetId: job.sourceAssetId, previewUrl: originalPreviewUrl },
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

  // GET /artwork-jobs/:jobId/results/:resultId/download — 下载生成结果
  app.get<{ Params: { jobId: string; resultId: string }; Querystring: { disposition?: 'preview' | 'attachment' } }>(
    '/artwork-jobs/:jobId/results/:resultId/download',
    {
      schema: {
        tags: ['AI 平面素材'],
        summary: '下载平面素材生成结果',
        params: {
          type: 'object',
          required: ['jobId', 'resultId'],
          properties: {
            jobId: { type: 'string', format: 'uuid' },
            resultId: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { disposition: { type: 'string', enum: ['preview', 'attachment'] } },
        },
      },
    },
    async request => {
      const userId = await requireClientSession(request.headers.authorization, redis);
      const { jobId, resultId } = request.params;
      const asAttachment = request.query.disposition !== 'preview';

      const row = await pool.query<{ objectKey: string; artworkKey: string }>(
        `SELECT av.object_key AS "objectKey", aj.artwork_key AS "artworkKey"
         FROM artwork_job_results ajr
         JOIN artwork_jobs aj ON aj.id = ajr.job_id
         JOIN scheme_assets sa ON sa.id = ajr.asset_id
         JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = sa.id ORDER BY created_at DESC, id DESC LIMIT 1) av ON true
         WHERE ajr.id = $1 AND ajr.job_id = $2 AND aj.user_id = $3`,
        [resultId, jobId, userId],
      );
      const r = row.rows[0];
      if (!r) throw Object.assign(new Error('Result not found'), { statusCode: 404 });

      const expiresIn = 300;
      const url = asAttachment
        ? await storage.signDownloadWithName(r.objectKey, `artwork-${r.artworkKey}-${resultId}.png`, expiresIn)
        : await storage.signDownload(r.objectKey, expiresIn);
      return { code: 0, data: { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() } };
    },
  );

  // PUT /artwork-jobs/:jobId/selection — 保存最终选择
  app.put<{ Params: { jobId: string }; Body: { resultId: string; expectedRevision: number } }>(
    '/artwork-jobs/:jobId/selection',
    {
      schema: {
        tags: ['AI 平面素材'],
        summary: '保存最终平面素材选择',
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
        id: string;
        schemeCode: string;
        artworkKey: string;
        status: string;
        selectedResultId: string | null;
        selectionRevision: number;
      }>(
        `SELECT id, scheme_code AS "schemeCode", artwork_key AS "artworkKey", status,
                selected_result_id AS "selectedResultId", selection_revision AS "selectionRevision"
         FROM artwork_jobs WHERE id = $1 AND user_id = $2`,
        [jobId, userId],
      );
      const job = jobQ.rows[0];
      if (!job) {
        reply.status(404);
        return { error: { code: 'REQUEST_ERROR', reason: 'RESOURCE_NOT_FOUND', message: 'Artwork job not found', requestId: request.id } };
      }
      if (!['succeeded', 'partially_succeeded'].includes(job.status)) {
        reply.status(409);
        return { error: { code: 'REQUEST_ERROR', reason: 'OPERATION_FORBIDDEN', message: 'Job is not in a succeeded state', requestId: request.id } };
      }

      if (job.selectedResultId === resultId) {
        return { code: 0, data: { jobId, schemeCode: job.schemeCode, artworkKey: job.artworkKey, resultId, revision: job.selectionRevision, selectedAt: new Date().toISOString() } };
      }

      if (job.selectionRevision !== expectedRevision) {
        reply.status(409);
        return { error: { code: 'REQUEST_ERROR', reason: 'SELECTION_CONFLICT', message: 'Selection revision conflict', requestId: request.id } };
      }

      const resultQ = await pool.query<{ id: string }>(
        `SELECT id FROM artwork_job_results WHERE id = $1 AND job_id = $2`,
        [resultId, jobId],
      );
      if (!resultQ.rows[0]) {
        reply.status(404);
        return { error: { code: 'REQUEST_ERROR', reason: 'RESOURCE_NOT_FOUND', message: 'Result not found', requestId: request.id } };
      }

      const updated = await pool.query<{ selectionRevision: number; updatedAt: string }>(
        `UPDATE artwork_jobs
         SET selected_result_id = $1, selection_revision = selection_revision + 1, updated_at = now()
         WHERE id = $2 AND user_id = $3 AND selection_revision = $4
         RETURNING selection_revision AS "selectionRevision", updated_at AS "updatedAt"`,
        [resultId, jobId, userId, expectedRevision],
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
          artworkKey: job.artworkKey,
          resultId,
          revision: updated.rows[0].selectionRevision,
          selectedAt: updated.rows[0].updatedAt,
        },
      };
    },
  );

  // POST /artwork-jobs/:jobId/events-ticket — 获取 SSE 票据
  app.post<{ Params: { jobId: string } }>('/artwork-jobs/:jobId/events-ticket', async request => {
    const userId = await requireClientSession(request.headers.authorization, redis);
    const owned = await pool.query('SELECT 1 FROM artwork_jobs WHERE id = $1 AND user_id = $2', [request.params.jobId, userId]);
    if (!owned.rows[0]) throw Object.assign(new Error('Artwork job not found'), { statusCode: 404 });
    const ticket = randomUUID();
    await redis.set(`artwork-events-ticket:${ticket}`, JSON.stringify({ jobId: request.params.jobId, userId }), 'EX', 300);
    return { code: 0, data: { ticket } };
  });

  // GET /artwork-jobs/:jobId/events — SSE 实时进度
  app.get<{ Params: { jobId: string }; Querystring: { ticket?: string } }>(
    '/artwork-jobs/:jobId/events',
    async (request, reply) => {
      const ticket = request.query.ticket;
      const raw = ticket ? await redis.get(`artwork-events-ticket:${ticket}`) : null;
      const ticketData = raw ? JSON.parse(raw) as { jobId: string; userId: string } : null;
      if (!ticketData || ticketData.jobId !== request.params.jobId) {
        reply.status(401);
        return { error: { code: 'REQUEST_ERROR', message: 'Invalid events ticket', requestId: request.id } };
      }
      await redis.del(`artwork-events-ticket:${ticket}`);
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
      response.write(': connected\n\n');
      const subscriber = redis.duplicate();
      const channel = `artwork-job:${request.params.jobId}`;
      const onMessage = (_channel: string, message: string) => response.write(`event: update\ndata: ${message}\n\n`);
      subscriber.on('message', onMessage);
      const cleanup = async () => {
        subscriber.off('message', onMessage);
        await subscriber.unsubscribe(channel);
        subscriber.disconnect();
      };
      request.raw.on('close', () => { void cleanup(); });
      await subscriber.subscribe(channel);
    },
  );
}
