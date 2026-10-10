import assert from 'node:assert/strict';
import test from 'node:test';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { createThemeOffer, loadThemeOffer, ThemeOfferExpiredError } from '../../src/modules/generation/theme/offers.js';
import { submitThemeJob } from '../../src/modules/generation/theme/submission.js';
import { createArtworkOffer, loadArtworkOffer } from '../../src/modules/generation/artwork/offers.js';
import { submitArtworkJob } from '../../src/modules/generation/artwork/submission.js';
import { artworkHash } from '../../src/modules/generation/artwork/queries.js';
import { ARTWORK_QUALITY, type ArtworkOffer } from '../../src/modules/generation/artwork/types.js';
import { type ThemeOfferData } from '../../src/modules/generation/theme/service.js';
import { assignedRow } from '../helpers/ai-fixtures.js';

const userId = 'user';
const theme = {
  schemeCode: 'S-1',
  sourceAssetId: 'source',
  input: { industryId: 'industry', styleId: 'style' },
  requestedCount: 2,
  cacheMode: 'reuse' as const,
};
const artwork = { schemeCode: 'S-1', themeJobId: 'theme-job', resultId: 'result', selectionRevision: 1 };

function offerStore() {
  const values = new Map<string, string>();
  const writes: { key: string; mode: string; ttl: number }[] = [];
  const reads: string[] = [];
  const redis = {
    set: async (key: string, value: string, mode: string, ttl: number) => {
      writes.push({ key, mode, ttl });
      values.set(key, value);
      return 'OK';
    },
    get: async (key: string) => {
      reads.push(key);
      return values.get(key) ?? null;
    },
  } as unknown as Redis;
  return { redis, values, writes, reads };
}

function quotePool(options: { available?: boolean; cached?: boolean; searchOwned?: boolean } = {}) {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push(sql);
      if (sql.includes('FROM ai_model_assignments'))
        return { rows: options.available === false ? [] : [assignedRow('openai', 'theme', { unitCredits: 7, revision: 3 })] };
      if (sql.includes('FROM dictionaries d'))
        return {
          rows: [
            { type: 'industry', id: 'industry', label: '科技' },
            { type: 'industry', id: 'industry-2', label: '汽车' },
            { type: 'style', id: 'style', label: '现代' },
          ],
        };
      if (sql.includes('FROM selection_searches')) {
        assert.deepEqual(params, ['search', userId, theme.schemeCode]);
        return { rows: options.searchOwned === false ? [] : [{ exists: 1 }] };
      }
      if (sql.includes('FROM scheme_baseline_assets a JOIN schemes'))
        return { rows: [{ assetId: 'source', versionId: 'v1', objectKey: 'source.png', checksum: 'hash' }] };
      if (sql.includes('a.related_asset_id')) return { rows: [] };
      if (sql.includes('FROM dictionary_items'))
        return {
          rows: [
            { id: 'industry', label: '科技' },
            { id: 'style', label: '现代' },
          ],
        };
      if (sql.includes('FROM prompt_templates')) return { rows: [] };
      if (sql.includes('FROM theme_jobs j')) return { rows: options.cached ? [{ id: 'cached' }] : [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;
  return { pool, queries };
}

test('theme capability discovery returns combinations without persisting an offer when input or models are missing', async () => {
  for (const available of [true, false]) {
    const { pool, queries } = quotePool({ available });
    const { redis, writes } = offerStore();
    const result = await createThemeOffer(pool, redis, userId, available ? { schemeCode: 'S-1', sourceAssetId: 'source' } : theme);
    assert.equal(result.available, available);
    assert.deepEqual(result.blockedReasons, available ? [] : ['MODEL_UNAVAILABLE']);
    assert.equal(result.offer, null);
    assert.deepEqual(result.supportedCombinations, [
      { industryId: 'industry', styleId: 'style' },
      { industryId: 'industry-2', styleId: 'style' },
    ]);
    assert.deepEqual(result.limits, { maxBrandColors: 3, maxKeywordCharacters: 200, allowedCounts: [1, 2, 3, 4] });
    assert.equal(writes.length, 0);
    assert.equal(queries.length, 2);
  }
});

test('theme service freezes normalized pricing and snapshot with a five-minute Redis TTL', async () => {
  const { pool } = quotePool();
  const { redis, writes } = offerStore();
  const before = Date.now();
  const result = await createThemeOffer(pool, redis, userId, {
    ...theme,
    searchId: 'search',
    input: { ...theme.input, brandColors: ['#aabbcc', '#AABBCC'], brandKeywords: '  brand  ' },
  });
  assert.ok(result.offer);
  assert.equal(result.offer.maxCredits, 14);
  assert.equal(result.offer.pricingRevision, 3);
  assert.equal(result.offer.settlementRule, 'per_usable_image');
  assert.deepEqual(writes, [{ key: `theme-offer:${result.offer.id}`, mode: 'EX', ttl: 300 }]);
  const stored = await loadThemeOffer(redis, result.offer.id);
  assert.equal(stored.userId, userId);
  assert.equal(stored.searchId, 'search');
  assert.equal(stored.requestedCount, 2);
  assert.deepEqual(stored.input, { ...theme.input, brandColors: ['#AABBCC'], brandKeywords: 'brand' });
  assert.equal(stored.unitCredits, result.offer.unitCredits);
  assert.equal(stored.expiresAt, result.offer.expiresAt);
  assert.ok(Date.parse(stored.expiresAt) >= before + 300_000);
  assert.ok(Date.parse(stored.expiresAt) <= Date.now() + 300_000);
});

test('theme quote defaults to one reused image and refresh bypasses a free cached result', async () => {
  const { pool, queries } = quotePool({ cached: true });
  const { redis } = offerStore();
  const cached = await createThemeOffer(pool, redis, userId, {
    schemeCode: theme.schemeCode,
    sourceAssetId: theme.sourceAssetId,
    input: theme.input,
  });
  assert.ok(cached.offer);
  assert.equal(cached.offer.maxCredits, 0);
  assert.equal(cached.offer.cacheHit, true);
  const stored = await loadThemeOffer(redis, cached.offer.id);
  assert.equal(stored.requestedCount, 1);
  assert.equal(stored.cacheMode, 'reuse');
  queries.length = 0;
  const refreshed = await createThemeOffer(pool, redis, userId, { ...theme, cacheMode: 'refresh' });
  assert.equal(refreshed.offer?.maxCredits, 14);
  assert.equal(refreshed.offer?.cacheHit, false);
  assert.ok(!queries.some(sql => sql.includes('FROM theme_jobs j')));
});

test('theme quote rejects an unowned search before reading snapshots or writing offers', async () => {
  const { pool, queries } = quotePool({ searchOwned: false });
  const { redis, writes } = offerStore();
  await assert.rejects(createThemeOffer(pool, redis, userId, { ...theme, searchId: 'search' }), { reason: 'SEARCH_UNAVAILABLE' });
  assert.equal(writes.length, 0);
  assert.ok(!queries.some(sql => sql.includes('scheme_baseline_assets')));
});

test('theme submission replays before accessing Redis, rejects conflicts and rejects missing offers before creation', async () => {
  let exists = true;
  const pool = {
    query: async (sql: string) => {
      assert.ok(sql.includes('FROM theme_jobs WHERE user_id'));
      return { rows: exists ? [{ ...theme, id: 'job', status: 'pending', cacheHit: false, usableCount: 0, unitCredits: 7 }] : [] };
    },
  } as unknown as pg.Pool;
  const { redis, reads } = offerStore();
  const input = { ...theme, requestKey: 'request', offerId: 'expired' };
  const replay = await submitThemeJob(pool, redis, userId, input);
  assert.equal(replay.reusedRequest, true);
  assert.equal(replay.jobId, 'job');
  assert.equal(replay.credits.heldCredits, 14);
  await assert.rejects(submitThemeJob(pool, redis, userId, { ...input, requestedCount: 1 }), { reason: 'REQUEST_CONFLICT' });
  assert.deepEqual(reads, []);
  exists = false;
  await assert.rejects(submitThemeJob(pool, redis, userId, input), ThemeOfferExpiredError);
  assert.deepEqual(reads, ['theme-offer:expired']);
});

test('theme submission delegates offer ownership validation before creating a job', async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  const { redis, values } = offerStore();
  values.set('theme-offer:other', JSON.stringify({ ...theme, userId: 'other' } satisfies Partial<ThemeOfferData>));
  await assert.rejects(submitThemeJob(pool, redis, userId, { ...theme, requestKey: 'request', offerId: 'other' }), {
    reason: 'OFFER_MISMATCH',
  });
});

test('artwork offer service freezes selected artwork and four-direction pricing with a five-minute TTL', async () => {
  let selectionAvailable = true;
  const pool = {
    query: async (sql: string) => {
      if (sql.includes('FROM theme_jobs'))
        return {
          rows: selectionAvailable
            ? [{ input: theme.input, sourceAssetId: 'selected', versionId: 'v1', objectKey: 'selected.png', checksum: 'hash' }]
            : [],
        };
      if (sql.includes('FROM ai_model_assignments')) return { rows: [assignedRow('openai', 'artwork', { unitCredits: 9 })] };
      if (sql.includes('FROM dictionary_items') || sql.includes('FROM prompt_templates')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;
  const { redis, writes } = offerStore();
  const before = Date.now();
  const result = await createArtworkOffer(pool, redis, userId, artwork);
  assert.equal(result.available, true);
  assert.deepEqual(result.quality, ARTWORK_QUALITY);
  assert.equal(result.offer.unitCredits, 9);
  assert.equal(result.offer.maxCredits, 36);
  assert.equal(result.offer.settlementRule, 'per_usable_direction');
  assert.deepEqual(writes, [{ key: `artwork-offer:${result.offer.id}`, mode: 'EX', ttl: 300 }]);
  const stored = await loadArtworkOffer(redis, result.offer.id);
  assert.equal(stored.userId, userId);
  assert.equal(stored.snapshot.source.assetId, 'selected');
  assert.equal(stored.selectionRevision, artwork.selectionRevision);
  assert.equal(stored.expiresAt, result.offer.expiresAt);
  assert.ok(Date.parse(stored.expiresAt) >= before + 300_000);
  assert.ok(Date.parse(stored.expiresAt) <= Date.now() + 300_000);
  selectionAvailable = false;
  await assert.rejects(createArtworkOffer(pool, redis, userId, artwork), { reason: 'THEME_SELECTION_CHANGED' });
  assert.equal(writes.length, 1);
});

test('artwork submission replays before accessing Redis, rejects conflicts and rejects missing or unowned offers', async () => {
  let exists = true;
  const pool = {
    query: async (sql: string) => {
      assert.ok(sql.includes('FROM artwork_jobs WHERE user_id'));
      return {
        rows: exists
          ? [{ id: 'job', status: 'pending', deliveryStatus: 'pending', unitCredits: 9, usableCount: 0, requestHash: artworkHash(artwork) }]
          : [],
      };
    },
  } as unknown as pg.Pool;
  const { redis, reads, values } = offerStore();
  const input = { ...artwork, requestKey: 'request', offerId: 'expired' };
  const replay = await submitArtworkJob(pool, redis, userId, input);
  assert.equal(replay.reusedRequest, true);
  assert.equal(replay.jobId, 'job');
  assert.equal(replay.credits.heldCredits, 36);
  await assert.rejects(submitArtworkJob(pool, redis, userId, { ...input, selectionRevision: 2 }), { reason: 'REQUEST_CONFLICT' });
  assert.deepEqual(reads, []);
  exists = false;
  await assert.rejects(submitArtworkJob(pool, redis, userId, input), { reason: 'OFFER_EXPIRED', statusCode: 409 });
  assert.deepEqual(reads, ['artwork-offer:expired']);
  values.set('artwork-offer:other', JSON.stringify({ ...artwork, userId: 'other' } satisfies Partial<ArtworkOffer>));
  await assert.rejects(submitArtworkJob(pool, redis, userId, { ...input, offerId: 'other' }), { reason: 'OFFER_MISMATCH' });
});
