import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type pg from 'pg';
import { registerAdminGenerationJobRoutes } from '../src/http/admin/generation-jobs/index.js';
import { getGenerationJob, listGenerationJobs } from '../src/modules/generation/queries.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const resultId = '00000000-0000-4000-8000-000000000003';
const row = {
  id: jobId, userId, schemeCode: 'SCHEME-001', sourceAssetId: jobId, offerId: 'offer', requestKey: 'key',
  status: 'succeeded', phase: null, requestedCount: 2, usableCount: 2, unitCredits: 10,
  cacheMode: 'reuse', selectionRevision: 0, selectedResultId: null,
  input: { industryId: userId, styleId: resultId, brandColors: [], brandKeywords: '' },
  createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:05Z'),
};

test('admin generation jobs list applies all filters, pagination and calculated metrics', async () => {
  const queries: { sql: string; args: unknown[] }[] = [];
  const pool = { query: async (sql: string, args: unknown[]) => {
    queries.push({ sql, args });
    return sql.includes('count(*)') ? { rows: [{ total: '1' }] } : { rows: [row] };
  } } as unknown as pg.Pool;
  const result = await listGenerationJobs(pool, {
    page: 2, pageSize: 5, jobType: 'theme', status: 'succeeded', userId, schemeCode: 'SCHEME-001', from: '2026-01-01', to: '2026-01-02',
  });
  assert.deepEqual(queries[0]?.args, ['succeeded', userId, 'SCHEME-001', '2026-01-01', '2026-01-02', 5, 5]);
  assert.deepEqual(queries[1]?.args, ['succeeded', userId, 'SCHEME-001', '2026-01-01', '2026-01-02']);
  assert.match(queries[0]?.sql ?? '', /j\.created_at < \(\$5::date \+ interval '1 day'\)/);
  assert.equal(result.total, 1);
  assert.equal(result.page, 2);
  assert.equal(result.data[0]?.jobType, 'theme');
  assert.equal(result.data[0]?.totalCreditsConsumed, 20);
  assert.equal(result.data[0]?.durationMs, 5000);
  assert.equal(queries.length, 2);
});

test('admin artwork list queries real task records and mixed lists include both job types', async () => {
  const queries: string[] = [];
  const pool = { query: async (sql: string) => {
    queries.push(sql);
    return sql.includes('count(*)') ? { rows: [{ total: '1' }] } : { rows: [{ ...row, jobType: 'artwork', requestedCount: 4, usableCount: 3 }] };
  } } as unknown as pg.Pool;
  const result = await listGenerationJobs(pool, { jobType: 'artwork' });
  assert.equal(result.data[0]?.jobType, 'artwork');
  assert.equal(result.data[0]?.totalCreditsConsumed, 30);
  assert.ok(queries.every(sql => sql.includes('FROM artwork_jobs')));
  await listGenerationJobs(pool, {});
  assert.match(queries[2]!, /UNION ALL/);
});

test('admin generation job detail loads results, labels and signed original preview', async () => {
  const queries: { sql: string; args: unknown[] }[] = [];
  const pool = { query: async (sql: string, args: unknown[]) => {
    queries.push({ sql, args });
    if (sql.includes('FROM theme_jobs')) return { rows: [{ ...row, unitCredits: null, selectedResultId: resultId }] };
    if (sql.includes('FROM theme_job_results')) return { rows: [
      { id: resultId, ordinal: 1, assetId: 'asset', objectKey: 'result/key', width: null, height: null, createdAt: row.updatedAt },
    ] };
    if (sql.includes('FROM dictionary_items')) return { rows: [{ id: userId, label: '行业' }, { id: resultId, label: '风格' }] };
    if (sql.includes('FROM scheme_assets')) return { rows: [{ objectKey: 'original/key' }] };
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as pg.Pool;
  const signed: unknown[][] = [];
  const detail = await getGenerationJob(pool, jobId, { signDownload: async (...args) => {
    signed.push(args);
    return 'https://example.test/original';
  } });
  assert.equal(detail.totalCreditsConsumed, null);
  assert.equal(detail.durationMs, 5000);
  assert.equal(detail.isSelected, true);
  assert.equal(detail.results[0]?.id, resultId);
  assert.equal(detail.industryLabel, '行业');
  assert.equal(detail.styleLabel, '风格');
  assert.equal(detail.sourcePreviewUrl, 'https://example.test/original');
  assert.deepEqual(signed, [['original/key', 300], ['result/key', 300]]);
  assert.equal(detail.results[0]?.previewUrl, 'https://example.test/original');
  assert.match(queries[1]?.sql ?? '', /ORDER BY r\.ordinal ASC,r\.id ASC/);
  assert.match(queries[3]?.sql ?? '', /ORDER BY created_at DESC, id DESC/);
  assert.deepEqual(queries.map(query => query.args), [[jobId], [jobId], [[userId, resultId]], [jobId]]);
});

test('admin cache-hit metrics report zero credits consumed', async () => {
  const pool = { query: async (sql: string) => sql.includes('count(*)') ? { rows: [{ total: '1' }] } :
    { rows: [{ ...row, cacheHit: true }] } } as unknown as pg.Pool;
  const result = await listGenerationJobs(pool, {});
  assert.equal(result.data[0]?.cacheHit, true);
  assert.equal(result.data[0]?.totalCreditsConsumed, 0);
});

test('admin generation job detail tolerates missing labels, missing asset and signing failure', async () => {
  let hasAsset = false;
  const pool = { query: async (sql: string) => {
    if (sql.includes('FROM theme_jobs')) return { rows: [{ ...row, input: { industryId: userId } }] };
    if (sql.includes('FROM scheme_assets')) return { rows: hasAsset ? [{ objectKey: 'original/key' }] : [] };
    return { rows: [] };
  } } as unknown as pg.Pool;
  const missing = await getGenerationJob(pool, jobId);
  assert.equal(missing.industryLabel, null);
  assert.equal(missing.styleLabel, null);
  assert.equal(missing.sourcePreviewUrl, null);
  hasAsset = true;
  const failure = await getGenerationJob(pool, jobId, { signDownload: async () => { throw new Error('Signing failed'); } });
  assert.equal(failure.sourcePreviewUrl, null);
});

test('admin generation job detail route forwards storage for original preview', async t => {
  const pool = { query: async (sql: string) => {
    if (sql.includes('FROM theme_jobs')) return { rows: [row] };
    if (sql.includes('FROM scheme_assets')) return { rows: [{ objectKey: 'original/key' }] };
    return { rows: [] };
  } } as unknown as pg.Pool;
  const app = Fastify();
  await registerAdminGenerationJobRoutes(app, pool, { signDownload: async (key, expiresIn) => {
    assert.equal(key, 'original/key');
    assert.equal(expiresIn, 300);
    return 'https://example.test/original';
  } });
  t.after(() => app.close());
  const response = await app.inject(`/generation-jobs/${jobId}`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.sourcePreviewUrl, 'https://example.test/original');
});

test('admin generation job routes validate queries and params, and return 404 for missing jobs', async t => {
  const pool = { query: async (sql: string) => sql.includes('count(*)') ? { rows: [{ total: '0' }] } : { rows: [] } } as unknown as pg.Pool;
  const app = Fastify();
  await registerAdminGenerationJobRoutes(app, pool, { signDownload: async () => 'https://example.test/original' });
  t.after(() => app.close());

  const list = await app.inject('/generation-jobs?jobType=artwork');
  assert.deepEqual(list.json(), { code: 0, data: { data: [], total: 0, page: 1, pageSize: 20 } });
  assert.equal((await app.inject('/generation-jobs?pageSize=101')).statusCode, 400);
  assert.equal((await app.inject('/generation-jobs?from=not-a-date')).statusCode, 400);
  assert.equal((await app.inject('/generation-jobs?status=unknown')).statusCode, 400);
  assert.equal((await app.inject('/generation-jobs/not-a-uuid')).statusCode, 400);
  const missing = await app.inject(`/generation-jobs/${jobId}`);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().code, 'NOT_FOUND');
});
