import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { registerErrorContract } from '../../src/http/errors.js';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { registerThemeModelRoutes } from '../../src/http/client/theme-jobs/index.js';
import { registerAuthentication } from '../../src/http/authentication.js';
import type { createStorage } from '../../src/infra/storage.js';
import { themeCacheKey, normalizeThemeInput, type GenerationSnapshot, type ThemeParameters, type ThemeOfferData } from '../../src/modules/generation/theme/service.js';
import { assignedRow } from '../helpers/ai-fixtures.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const resultId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const token = 'test-token';
const sessionKey = `session:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;

type Query = (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number };

async function setup(query: Query) {
  const statements: string[] = [];
  let created: Record<string, unknown> | undefined;
  const run = async (sql: string, params?: unknown[]) => {
    statements.push(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('session_version')) return { rows: [{ enabled: true, roles: [], sessionVersion: 1 }] };
    if (sql.includes('FROM ai_model_assignments')) return { rows: [assignedRow('openai', 'theme', { id: 'theme-model', unitCredits: 10 })] };
    if (sql.includes('FROM dictionaries d')) return { rows: [{ type: 'industry', id: 'industry', label: '科技' }, { type: 'style', id: 'style', label: '现代' }] };
    if (sql.includes('FROM scheme_baseline_assets a JOIN schemes')) return { rows: [{ assetId: 'source', versionId: 'source-v1', objectKey: 'source.png', checksum: 'source-hash' }] };
    if (sql.includes('a.related_asset_id')) return { rows: [] };
    if (sql.includes('FROM dictionary_items')) return { rows: [{ id: 'industry', label: '科技' }, { id: 'style', label: '现代' }] };
    if (sql.includes('FROM prompt_templates')) return { rows: [] };
    if (sql.includes('FROM theme_jobs WHERE id = $1') && created) return { rows: [created] };
    if (sql.includes('SELECT user_id AS "userId", reserved_amount')) return { rows: [] };
    const result = query(sql, params);
    if (sql.includes('INSERT INTO theme_jobs')) created = { ...result.rows[0] as Record<string, unknown>, userId };
    return result;
  };
  const pool = {
    query: run,
    connect: async () => ({ query: run, release: () => {} }),
  } as unknown as pg.Pool;
  const offers = new Map<string, string>();
  const redis = {
    eval: async () => 1,
    get: async (key: string) => key === sessionKey
      ? JSON.stringify({ site: 'client', localId: userId, sessionVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 60 })
      : offers.get(key) ?? null,
    set: async (key: string, value: string) => { offers.set(key, value); return 'OK'; },
  } as unknown as Redis;
  const storage = {
    signDownload: async (key: string) => `https://assets.example/${key}`,
  } as unknown as ReturnType<typeof createStorage>;
  const app = Fastify();
  registerAuthentication(app, pool, redis, 'client');
  registerErrorContract(app);
  await registerThemeModelRoutes(app, pool, redis, storage);
  await app.ready();
  return { app, statements, offers };
}

const parameters: ThemeParameters = { schemeCode: 'S-1', sourceAssetId: 'source', input: { industryId: 'industry', styleId: 'style' }, requestedCount: 1, cacheMode: 'reuse' };
const headers = { authorization: `Bearer ${token}` };
async function offerFor(app: Awaited<ReturnType<typeof setup>>['app'], input = parameters) {
  const response = await app.inject({ method: 'POST', url: '/theme-offers', headers, payload: input });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().data.offer as { id: string; cacheHit: boolean; maxCredits: number };
}

test('theme job details include ordered results with nullable fields normalized', async t => {
  const { app } = await setup(sql => {
    if (sql.includes('FROM theme_jobs')) return { rows: [{
       id: jobId, schemeCode: 'S-1', sourceAssetId: 'source', sourceObjectKey: 'source/image.png', status: 'succeeded', phase: null,
      requestedCount: 1, usableCount: 1, selectedResultId: null, selectionRevision: 0,
      unitCredits: 10, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }] };
     if (sql.includes('FROM theme_job_results')) return { rows: [{ id: resultId, ordinal: 0, objectKey: 'generated/image.png', width: null, height: 720 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: `/theme-jobs/${jobId}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200);
   assert.deepEqual(response.json().data.results, [{ resultId, previewUrl: 'https://assets.example/generated/image.png', width: 0, height: 720 }]);
   assert.deepEqual(response.json().data.original, { assetId: 'source', previewUrl: 'https://assets.example/source/image.png' });
});

test('creating a theme job writes the outbox entry in the same transaction', async t => {
  const { app, statements } = await setup(sql => {
    if (sql.includes('FROM users')) return { rows: [{ id: userId }] };
    if (sql.includes('availableBalance')) return { rows: [{ availableBalance: 100 }] };
    if (sql.includes('credit_reservations')) return { rows: [] };
    if (sql.includes('FROM theme_jobs')) return { rows: [] };
    if (sql.includes('INSERT INTO theme_jobs')) return { rows: [{ id: jobId, status: 'pending', cacheHit: false, requestedCount: 1, usableCount: 0, unitCredits: 10 }] };
    if (sql.includes('INSERT INTO theme_job_outbox')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const offer = await offerFor(app);
  const response = await app.inject({ method: 'POST', url: '/theme-jobs', headers: { authorization: `Bearer ${token}` }, payload: {
    requestKey: '00000000-0000-4000-8000-000000000004', offerId: offer.id, schemeCode: 'S-1',
    sourceAssetId: 'source', input: { industryId: 'industry', styleId: 'style' }, requestedCount: 1,
  } });
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().data.jobId, jobId);
  assert.ok(statements.indexOf('BEGIN') < statements.findIndex(sql => sql.includes('INSERT INTO theme_jobs')));
  assert.ok(statements.findIndex(sql => sql.includes('INSERT INTO theme_jobs')) < statements.findIndex(sql => sql.includes('INSERT INTO theme_job_outbox')));
  assert.ok(statements.findIndex(sql => sql.includes('INSERT INTO theme_job_outbox')) < statements.indexOf('COMMIT'));
  assert.equal(response.json().data.cacheHit, false);
  assert.equal(response.json().data.credits.heldCredits, 10);
});

test('theme offer pins the complete normalized brief and submission persists the same prompt', async t => {
  let savedSnapshot: GenerationSnapshot | undefined;
  const { app, offers } = await setup((sql, params) => {
    if (sql.includes('FROM users')) return { rows: [{ id: userId }] };
    if (sql.includes('availableBalance')) return { rows: [{ availableBalance: 100 }] };
    if (sql.includes('FROM theme_jobs')) return { rows: [] };
    if (sql.includes('INSERT INTO theme_jobs')) {
      savedSnapshot = JSON.parse(params?.[11] as string) as GenerationSnapshot;
      return { rows: [{ id: jobId, status: 'pending', cacheHit: false, requestedCount: 1, usableCount: 0, unitCredits: 10 }] };
    }
    if (sql.includes('INSERT INTO')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const input = { ...parameters, input: { ...parameters.input, brandColors: ['#aabbcc', '#AABBCC', '#123456'], brandKeywords: '  展示储能产品，不要树叶  ' } };
  const offer = await offerFor(app, input);
  const storedOffer = JSON.parse(offers.get(`theme-offer:${offer.id}`)!) as ThemeOfferData;
  assert.deepEqual(JSON.parse(storedOffer.snapshot.prompt.split('\n')[2]!), {
    行业: '科技', 风格: '现代', 品牌色: '#AABBCC, #123456', 品牌关键词及补充要求: '展示储能产品，不要树叶',
  });
  const response = await app.inject({ method: 'POST', url: '/theme-jobs', headers,
    payload: { ...input, offerId: offer.id, requestKey: '00000000-0000-4000-8000-000000000004' } });
  assert.equal(response.statusCode, 202, response.body);
  assert.equal(savedSnapshot?.prompt, storedOffer.snapshot.prompt);
});

test('theme offers and submissions persist the owning search and reject unrelated search context', async t => {
  const searchId = '00000000-0000-4000-8000-000000000010';
  const wrongSearchId = '00000000-0000-4000-8000-000000000011';
  const { app } = await setup((sql, params) => {
    if (sql.includes('FROM selection_searches')) {
      assert.equal(params?.[1], userId);
      assert.equal(params?.[2], 'S-1');
      return { rows: params?.[0] === searchId ? [{ exists: 1 }] : [] };
    }
    if (sql.includes('FROM users')) return { rows: [{ id: userId }] };
    if (sql.includes('availableBalance')) return { rows: [{ availableBalance: 100 }] };
    if (sql.includes('FROM theme_jobs')) return { rows: [] };
    if (sql.includes('INSERT INTO theme_jobs')) {
      assert.ok(sql.includes('search_id'));
      assert.equal(params?.[15], searchId);
      return { rows: [{ id: jobId, status: 'pending', cacheHit: false, requestedCount: 1, usableCount: 0, unitCredits: 10 }] };
    }
    if (sql.includes('INSERT INTO')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const input = { ...parameters, searchId };
  const offer = await offerFor(app, input);
  const body = { ...input, offerId: offer.id, requestKey: '00000000-0000-4000-8000-000000000004' };
  const accepted = await app.inject({ method: 'POST', url: '/theme-jobs', headers, payload: body });
  assert.equal(accepted.statusCode, 202, accepted.body);
  const rejected = await app.inject({ method: 'POST', url: '/theme-offers', headers, payload: { ...input, searchId: wrongSearchId } });
  assert.equal(rejected.statusCode, 409);
  const mismatched = await app.inject({ method: 'POST', url: '/theme-jobs', headers, payload: { ...body, searchId: undefined } });
  assert.equal(mismatched.statusCode, 409);
  assert.equal(mismatched.json().error.reason, 'OFFER_MISMATCH');
});

test('cache offer and submission reuse assets for free without an outbox or reservation', async t => {
  const { app, statements } = await setup((sql, params) => {
    if (sql.includes('FROM theme_jobs j')) {
      assert.equal(params?.[0], userId);
      assert.equal(params?.[2], 1);
      return { rows: [{ id: 'cached-job' }] };
    }
    if (sql.includes('FROM theme_jobs WHERE')) return { rows: [] };
    if (sql.includes('FROM users')) return { rows: [{ id: userId }] };
    if (sql.includes('INSERT INTO theme_jobs')) return { rows: [{ id: jobId, status: 'succeeded', cacheHit: true, requestedCount: 1, usableCount: 1, unitCredits: 10 }] };
    if (sql.includes('INSERT INTO theme_job_results')) return { rows: [{ id: resultId }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const offer = await offerFor(app);
  assert.equal(offer.cacheHit, true);
  assert.equal(offer.maxCredits, 0);
  const response = await app.inject({ method: 'POST', url: '/theme-jobs', headers, payload: { ...parameters, requestKey: '00000000-0000-4000-8000-000000000004', offerId: offer.id } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.cacheHit, true);
  assert.equal(response.json().data.reusedRequest, false);
  assert.equal(response.json().data.pollAfterMs, null);
  assert.deepEqual(response.json().data.credits, { status: 'not_charged', reservedCredits: 0, heldCredits: 0, chargedCredits: 0, releasedCredits: 0 });
  assert.equal(response.headers.location, `/api/v1/client/theme-jobs/${jobId}`);
  assert.ok(!statements.some(sql => sql.includes('credit_reservations') || sql.includes('theme_job_outbox') || sql.includes('credit_transactions')));
});

test('refresh bypasses the result cache and reserves the quoted credits', async t => {
  const { app, statements } = await setup(sql => {
    if (sql.includes('FROM theme_jobs j')) throw new Error('refresh must not look up result cache');
    if (sql.includes('FROM theme_jobs WHERE')) return { rows: [] };
    if (sql.includes('FROM users')) return { rows: [{ id: userId }] };
    if (sql.includes('availableBalance')) return { rows: [{ availableBalance: 100 }] };
    if (sql.includes('INSERT INTO theme_jobs')) return { rows: [{ id: jobId, status: 'pending', cacheHit: false, requestedCount: 1, usableCount: 0, unitCredits: 10 }] };
    if (sql.includes('INSERT INTO')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const input: ThemeParameters = { ...parameters, cacheMode: 'refresh' };
  const offer = await offerFor(app, input);
  assert.equal(offer.cacheHit, false);
  assert.equal(offer.maxCredits, 10);
  const response = await app.inject({ method: 'POST', url: '/theme-jobs', headers, payload: { ...input, offerId: offer.id, requestKey: '00000000-0000-4000-8000-000000000004' } });
  assert.equal(response.statusCode, 202, response.body);
  assert.ok(statements.some(sql => sql.includes('INSERT INTO credit_reservations')));
});

test('idempotent cache replay works after offer expiry and preserves free billing', async t => {
  const { app, statements } = await setup(sql => {
    if (sql.includes('FROM theme_jobs')) return { rows: [{ ...parameters, id: jobId, status: 'succeeded', cacheHit: true, usableCount: 1, unitCredits: 10 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/theme-jobs', headers, payload: { ...parameters, offerId: 'expired', requestKey: '00000000-0000-4000-8000-000000000004' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.reusedRequest, true);
  assert.equal(response.json().data.cacheHit, true);
  assert.equal(response.json().data.credits.status, 'not_charged');
  assert.equal(response.headers.location, `/api/v1/client/theme-jobs/${jobId}`);
  assert.equal(statements.filter(sql => !sql.includes('session_version')).length, 1);
  const conflict = await app.inject({ method: 'POST', url: '/theme-jobs', headers, payload: { ...parameters, input: { ...parameters.input, brandKeywords: 'different' }, offerId: 'expired', requestKey: '00000000-0000-4000-8000-000000000004' } });
  assert.equal(conflict.statusCode, 409);
});

test('theme submission reports an expired offer through the shared error contract without creating a task', async t => {
  const { app, statements } = await setup(sql => {
    if (sql.includes('FROM theme_jobs WHERE')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/theme-jobs', headers,
    payload: { ...parameters, offerId: 'expired', requestKey: '00000000-0000-4000-8000-000000000004' } });
  assert.equal(response.statusCode, 409);
  const { error } = response.json();
  assert.equal(error.code, 'REQUEST_ERROR');
  assert.equal(error.reason, 'OFFER_EXPIRED');
  assert.equal(error.message, 'Invalid request');
  assert.equal(typeof error.requestId, 'string');
  assert.ok(!statements.includes('BEGIN'));
});

test('a free offer becoming unavailable requires reconfirmation instead of charging', async t => {
  let cacheAvailable = true;
  const { app, statements } = await setup(sql => {
    if (sql.includes('FROM theme_jobs j')) return { rows: cacheAvailable ? [{ id: 'cached-job' }] : [] };
    if (sql.includes('FROM theme_jobs WHERE')) return { rows: [] };
    if (sql.includes('FROM users')) return { rows: [{ id: userId }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const offer = await offerFor(app);
  cacheAvailable = false;
  const response = await app.inject({ method: 'POST', url: '/theme-jobs', headers, payload: { ...parameters, offerId: offer.id, requestKey: '00000000-0000-4000-8000-000000000004' } });
  assert.equal(response.statusCode, 409, response.body);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.some(sql => sql.includes('INSERT INTO')));
});

test('cached job detail returns not_charged and fresh signed URLs', async t => {
  const { app } = await setup(sql => {
    if (sql.includes('FROM theme_jobs')) return { rows: [{ id: jobId, schemeCode: 'S-1', sourceAssetId: 'source', sourceObjectKey: 'old-source.png', status: 'succeeded', cacheHit: true, requestedCount: 1, usableCount: 1, unitCredits: 10 }] };
    if (sql.includes('FROM theme_job_results')) return { rows: [{ id: resultId, ordinal: 1, objectKey: 'cached-result.png', width: null, height: null }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: `/theme-jobs/${jobId}`, headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.cacheHit, true);
  assert.equal(response.json().data.credits.chargedCredits, 0);
  assert.equal(response.json().data.credits.status, 'not_charged');
  assert.equal(response.json().data.results[0].previewUrl, 'https://assets.example/cached-result.png');
});

test('cache fingerprint normalizes input and isolates all generation dependencies', () => {
  const snapshot: GenerationSnapshot = { source: { assetId: 'source', versionId: 'v1', objectKey: 'source.png', checksum: 'hash' }, mask: null,
    template: null, models: [{ id: 'model', model: 'image-model', revision: 1, position: 1, unitCredits: 10 }], prompt: 'prompt', pipelineRevision: 1 };
  const input: ThemeParameters = { ...parameters, input: { ...parameters.input, brandColors: ['#aabbcc', '#AABBCC'], brandKeywords: ' brand ' } };
  const key = themeCacheKey(userId, input, snapshot);
  assert.equal(key, themeCacheKey(userId, { ...input, input: { ...input.input, brandColors: ['#AABBCC'], brandKeywords: 'brand' } }, snapshot));
  assert.deepEqual(normalizeThemeInput(input.input).brandColors, ['#AABBCC']);
  for (const changed of [ { ...input, sourceAssetId: 'other' }, { ...input, requestedCount: 2 },
    { ...input, input: { ...input.input, industryId: 'other' } }, { ...input, input: { ...input.input, styleId: 'other' } },
    { ...input, input: { ...input.input, brandKeywords: 'other' } }, { ...input, input: { ...input.input, brandColors: ['#FFFFFF'] } } ]) {
    assert.notEqual(key, themeCacheKey(userId, changed, snapshot));
  }
  assert.notEqual(key, themeCacheKey('other-user', input, snapshot));
  for (const changed of [ { ...snapshot, source: { ...snapshot.source, checksum: 'changed' } },
    { ...snapshot, mask: { ...snapshot.source, assetId: 'mask' } }, { ...snapshot, template: { id: 'template', revision: 2, body: 'new' } },
    { ...snapshot, models: [{ ...snapshot.models[0]!, revision: 2 }] }, { ...snapshot, pipelineRevision: 2 },
    { ...snapshot, prompt: 'updated default prompt' } ]) {
    assert.notEqual(key, themeCacheKey(userId, input, changed));
  }
});

test('selection validates result ownership and increments revision via CAS', async t => {
  const { app, statements } = await setup(sql => {
    if (sql.includes('FROM theme_jobs')) return { rows: [{
      id: jobId, schemeCode: 'S-1', status: 'succeeded', selectedResultId: null, selectionRevision: 0,
    }] };
    if (sql.includes('FROM theme_job_results')) return { rows: [{ id: resultId }] };
    if (sql.includes('UPDATE theme_jobs')) return { rows: [{ selectionRevision: 1, updatedAt: '2026-01-02' }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'PUT', url: `/theme-jobs/${jobId}/selection`, headers: { authorization: `Bearer ${token}` }, payload: {
    resultId, expectedRevision: 0,
  } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, { jobId, schemeCode: 'S-1', resultId, revision: 1, selectedAt: '2026-01-02' });
  assert.ok(statements.some(sql => sql.includes('selection_revision = $4')));
});
