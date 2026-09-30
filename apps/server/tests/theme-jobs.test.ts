import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { registerThemeModelRoutes } from '../src/modules/client/theme-jobs/index.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const resultId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const token = 'test-token';
const sessionKey = `session:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;

type Query = (sql: string, params?: unknown[]) => { rows: unknown[] };

async function setup(query: Query) {
  const statements: string[] = [];
  const run = async (sql: string, params?: unknown[]) => {
    statements.push(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    return query(sql, params);
  };
  const pool = {
    query: run,
    connect: async () => ({ query: run, release: () => {} }),
  } as unknown as pg.Pool;
  const redis = {
    get: async (key: string) => key === sessionKey
      ? JSON.stringify({ site: 'client', localId: userId, expiresAt: Math.floor(Date.now() / 1000) + 60 })
      : key === 'theme-offer:offer-1' ? JSON.stringify({ unitCredits: 10, pricingRevision: 1 }) : null,
  } as unknown as Redis;
  const app = Fastify();
  await registerThemeModelRoutes(app, pool, redis);
  await app.ready();
  return { app, statements };
}

test('theme job details include ordered results with nullable fields normalized', async t => {
  const { app } = await setup(sql => {
    if (sql.includes('FROM theme_jobs')) return { rows: [{
      id: jobId, schemeCode: 'S-1', sourceAssetId: 'source', status: 'succeeded', phase: null,
      requestedCount: 1, usableCount: 1, selectedResultId: null, selectionRevision: 0,
      unitCredits: 10, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }] };
    if (sql.includes('FROM theme_job_results')) return { rows: [{ id: resultId, ordinal: 0, previewUrl: null, width: null, height: 720 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: `/theme-jobs/${jobId}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.results, [{ resultId, previewUrl: '', width: 0, height: 720 }]);
  assert.deepEqual(response.json().data.original, { assetId: 'source', previewUrl: null });
});

test('creating a theme job writes the outbox entry in the same transaction', async t => {
  const { app, statements } = await setup(sql => {
    if (sql.includes('FROM theme_jobs')) return { rows: [] };
    if (sql.includes('INSERT INTO theme_jobs')) return { rows: [{ id: jobId }] };
    if (sql.includes('INSERT INTO theme_job_outbox')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/theme-jobs', headers: { authorization: `Bearer ${token}` }, payload: {
    requestKey: '00000000-0000-4000-8000-000000000004', offerId: 'offer-1', schemeCode: 'S-1',
    sourceAssetId: 'source', input: { industryId: 'industry', styleId: 'style' }, requestedCount: 1,
  } });
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().data.jobId, jobId);
  assert.ok(statements.indexOf('BEGIN') < statements.findIndex(sql => sql.includes('INSERT INTO theme_jobs')));
  assert.ok(statements.findIndex(sql => sql.includes('INSERT INTO theme_jobs')) < statements.findIndex(sql => sql.includes('INSERT INTO theme_job_outbox')));
  assert.ok(statements.findIndex(sql => sql.includes('INSERT INTO theme_job_outbox')) < statements.indexOf('COMMIT'));
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
