import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { assignedAiModels } from '../../../infra/ai/config.js';
import { assertThemeSearch, findCachedThemeJob, loadGenerationSnapshot, normalizeThemeInput,
  themeCacheKey, type ThemeInput, type ThemeOfferData } from './service.js';

const OFFER_TTL_SECONDS = 300;

export type ThemeOfferInput = {
  schemeCode: string;
  sourceAssetId: string;
  input?: ThemeInput;
  requestedCount?: number;
  cacheMode?: 'reuse' | 'refresh';
  searchId?: string;
};

type ThemeOfferQuote = {
  id: string;
  expiresAt: string;
  pricingRevision: number;
  unitCredits: number;
  maxCredits: number;
  settlementRule: string;
  cacheHit: boolean;
};

export class ThemeOfferExpiredError extends Error {
  readonly statusCode = 409;
  readonly reason = 'OFFER_EXPIRED';

  constructor() {
    super('Offer expired or not found');
  }
}

export async function listThemeModels(pool: pg.Pool) {
  const models = await assignedAiModels(pool, 'theme');
  return models.map(({ id, model, unitCredits, revision }) => ({ id, model, unitCredits, revision }));
}

async function loadDictionaryOptions(pool: pg.Pool) {
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

export async function createThemeOffer(pool: pg.Pool, redis: Pick<Redis, 'set'>, userId: string, request: ThemeOfferInput) {
  const available = (await assignedAiModels(pool, 'theme')).length > 0;
  const blockedReasons = available ? [] : ['MODEL_UNAVAILABLE'];
  const { industries, styles } = await loadDictionaryOptions(pool);
  const supportedCombinations = industries.flatMap(ind => styles.map(sty => ({ industryId: ind.id, styleId: sty.id })));
  const limits = { maxBrandColors: 3, maxKeywordCharacters: 200, allowedCounts: [1, 2, 3, 4] };
  const { input, requestedCount = 1 } = request;
  let offer: ThemeOfferQuote | null = null;

  if (available && input?.industryId && input?.styleId) {
    const parameters = { schemeCode: request.schemeCode, sourceAssetId: request.sourceAssetId,
      input: normalizeThemeInput(input), requestedCount, cacheMode: request.cacheMode ?? 'reuse', searchId: request.searchId };
    await assertThemeSearch(pool, userId, parameters);
    const snapshot = await loadGenerationSnapshot(pool, parameters);
    const cacheKey = themeCacheKey(userId, parameters, snapshot);
    const cacheHit = parameters.cacheMode === 'reuse' && Boolean(await findCachedThemeJob(pool, userId, cacheKey, requestedCount));
    const primaryModel = snapshot.models[0]!;
    const unitCredits = primaryModel.unitCredits!;
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000).toISOString();
    const data: ThemeOfferData = { ...parameters, userId, cacheKey, snapshot, cacheHit, unitCredits, expiresAt,
      pricingRevision: primaryModel.revision };
    await redis.set(`theme-offer:${id}`, JSON.stringify(data), 'EX', OFFER_TTL_SECONDS);
    offer = { id, expiresAt, pricingRevision: primaryModel.revision, unitCredits,
      maxCredits: cacheHit ? 0 : unitCredits * requestedCount, settlementRule: 'per_usable_image', cacheHit };
  }

  return { available, blockedReasons, limits, supportedCombinations, offer };
}

export async function loadThemeOffer(redis: Pick<Redis, 'get'>, offerId: string): Promise<ThemeOfferData> {
  const raw = await redis.get(`theme-offer:${offerId}`);
  if (!raw) throw new ThemeOfferExpiredError();
  return JSON.parse(raw) as ThemeOfferData;
}
