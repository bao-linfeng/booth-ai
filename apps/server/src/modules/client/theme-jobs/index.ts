import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { listAiModels } from '../../../infra/ai-models.js';
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
}
