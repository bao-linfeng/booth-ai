import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { encryptCredential } from '../src/infra/ai-models.js';
import { processThemeJob } from '../src/modules/tasks/theme-worker.js';

const encryptionKey = 'a'.repeat(64);
const jobId = randomUUID();
const userId = randomUUID();
const industryId = randomUUID();
const styleId = randomUUID();
const config = {
  aiModelEncryptionKey: encryptionKey,
  s3: { endpoint: 'http://silo:9000', publicEndpoint: 'http://localhost:19000', region: 'us-east-1', bucket: 'booth-assets', accessKeyId: 'access', secretAccessKey: 'secret' },
};

test('theme worker generates real provider results and settles credits atomically', async t => {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const run = async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (sql.includes('FROM theme_jobs')) return { rows: [{ requestedCount: 2, sourceAssetId: randomUUID(), schemeCode: 'S-1', input: { industryId, styleId, brandColors: ['红', '蓝'], brandKeywords: '展会' }, unitCredits: 3, userId, status: 'pending' }] };
    if (sql.includes('RETURNING id')) return { rows: [{ id: jobId }], rowCount: 1 };
    if (sql.includes('FROM dictionary_items')) return { rows: [{ id: industryId, label: '科技' }, { id: styleId, label: '现代' }] };
    if (sql.includes('FROM prompt_templates')) {
      assert.deepEqual(params, ['theme', industryId, styleId]);
      return { rows: [{ id: randomUUID(), purpose: 'theme', industryId, styleId,
        body: '{{industryLabel}}/{{styleLabel}}/{{brandColors}}/{{brandKeywords}}', variables: [], enabled: true, revision: 1,
        createdAt: new Date(), updatedAt: new Date() }] };
    }
    if (sql.includes('FROM ai_model_configs')) return { rows: [{ purpose: 'theme', provider: 'openai', enabled: true, priority: 1, unitCredits: 3, revision: 1, credentialCiphertext: encryptCredential('api-key', 'openai', encryptionKey) }] };
    if (sql.includes('FROM scheme_assets')) return { rows: [{ objectKey: 'source/image.png' }] };
    return { rows: [], rowCount: 1 };
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => {} }) } as unknown as pg.Pool;
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('silo:9000')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer api-key');
    const body = init?.body as FormData;
    assert.equal(body.get('n'), '2');
    assert.equal(body.get('prompt'), '科技/现代/红, 蓝/展会');
    assert.equal(body.has('response_format'), false);
    return Response.json({ data: [{ b64_json: 'one' }, { b64_json: 'two' }] });
  };
  t.after(() => { globalThis.fetch = oldFetch; });

  const stored: string[] = [];
  await processThemeJob(pool, jobId, config, {
    putBuffer: async (key: string) => { stored.push(key); },
    signDownload: async (key: string) => `https://assets.example/${key}`,
  } as never);
  console.log(queries.map((query, index) => `${index}: ${query.sql} params=${JSON.stringify(query.params)}`).join('\n'));
  assert.equal(calls.length, 3);
  const resultInserts = queries.filter(q => q.sql.includes('INSERT INTO theme_job_results'));
  assert.equal(resultInserts.length, 2);
   assert.equal(stored.length, 2);
   assert.ok(resultInserts.every(query => query.params?.[3]));
  const debit = queries.findIndex(q => q.sql.includes('INSERT INTO credit_transactions'));
  const finish = queries.findIndex(q => q.sql.includes('UPDATE theme_jobs') && q.sql.includes('usable_count'));
  const commit = queries.slice(finish).findIndex(q => q.sql === 'COMMIT') + finish;
  const begin = queries.slice(0, debit).findLastIndex(q => q.sql === 'BEGIN');
  assert.ok(begin >= 0 && begin < debit && debit < finish && finish < commit);
  assert.deepEqual(queries[debit]?.params, [userId, -6, `theme_job:${jobId}`, jobId]);
  assert.deepEqual(queries[finish]?.params, ['succeeded', 2, jobId]);
});

test('theme worker marks a job failed without charging when no model is enabled', async () => {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const run = async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (sql.includes('FROM theme_jobs')) return { rows: [{ requestedCount: 1, sourceAssetId: randomUUID(), schemeCode: 'S-1', input: { industryId, styleId }, unitCredits: 3, userId, status: 'pending' }] };
    if (sql.includes('RETURNING id')) return { rows: [{ id: jobId }], rowCount: 1 };
    if (sql.includes('FROM dictionary_items')) return { rows: [{ id: industryId, label: '科技' }, { id: styleId, label: '现代' }] };
    if (sql.includes('FROM prompt_templates')) return { rows: [] };
    if (sql.includes('FROM ai_model_configs')) return { rows: [] };
    if (sql.includes('FROM scheme_assets')) return { rows: [{ objectKey: 'source/image.png' }] };
    return { rows: [], rowCount: 1 };
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => {} }) } as unknown as pg.Pool;
  await processThemeJob(pool, jobId, config);
  assert.ok(!queries.some(q => q.sql.includes('INSERT INTO credit_transactions')));
  const failedUpdate = queries.find(q => q.sql.includes("status = 'failed'") && q.sql.includes('theme_jobs'));
  assert.ok(failedUpdate, 'theme job should be marked failed');
  assert.ok(failedUpdate?.params?.includes(jobId));
});
