import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import sharp from 'sharp';
import type { ProviderProtocol } from '../../src/infra/ai/types.js';
import { assignedRow } from '../helpers/ai-fixtures.js';
import { GenerationInterruptedError } from '../../src/modules/generation/execution.js';
import { processThemeJob } from '../../src/modules/generation/theme/execution.js';

const encryptionKey = 'a'.repeat(64);
const config = {
  aiModelEncryptionKey: encryptionKey,
  s3: {
    endpoint: 'http://silo:9000',
    publicEndpoint: 'http://localhost:19000',
    region: 'us-east-1',
    bucket: 'booth-assets',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
  },
};

async function fixture(count = 2, prompt?: string, protocol: ProviderProtocol = 'openai', snapshotPatch: Record<string, unknown> = {}) {
  const jobId = randomUUID();
  const userId = randomUUID();
  const industryId = randomUUID();
  const styleId = randomUUID();
  const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } })
    .png()
    .toBuffer();
  const queries: { sql: string; params?: unknown[] }[] = [];
  const urls: { ordinal: number; url: string }[] = [];
  const results: { ordinal: number; resultId: string; previewUrl: string }[] = [];
  const attempts: { id: string; status: string; modelId: string; revision: number }[] = [];
  const modelRow = assignedRow(protocol, 'theme', { id: randomUUID(), apiKey: 'api-key' }, encryptionKey);
  let status = 'pending';
  let leaseToken: string | null = null;
  let charged = false;
  let enabled = true;
  const job = () => ({
    requestedCount: count,
    sourceAssetId: randomUUID(),
    schemeCode: 'S-1',
    input: { industryId, styleId, brandColors: ['红', '蓝'], brandKeywords: '展会' },
    unitCredits: 3,
    userId,
    status,
    leaseToken,
    leaseUntil: null,
    snapshot:
      prompt === undefined
        ? null
        : {
            prompt,
            mask: null,
            source: { objectKey: 'pinned.png' },
            models: [{ id: modelRow.id, model: modelRow.model, revision: 1, position: 1, unitCredits: 3 }],
            ...snapshotPatch,
          },
  });
  const run = async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (sql.startsWith('UPDATE theme_jobs SET lease_token = $2')) {
      if (['succeeded', 'partially_succeeded', 'failed'].includes(status) || leaseToken) return { rows: [], rowCount: 0 };
      leaseToken = String(params?.[1]);
      status = 'running';
      return { rows: [{ deadline: new Date(Date.now() + 30 * 60_000) }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE theme_jobs SET lease_token = NULL')) leaseToken = null;
    if (sql.includes('UPDATE theme_jobs SET status = $1')) status = String(params?.[0]);
    if (sql.includes('FROM users')) return { rows: [{ id: userId }] };
    if (sql.includes('FROM credit_reservations')) return { rows: [{ userId, amount: count * 3, status: 'reserved' }] };
    if (sql.includes('FROM credit_transactions'))
      return { rows: charged ? [{ userId, amount: -results.length * 3, kind: 'theme_consume' }] : [] };
    if (sql.includes('INSERT INTO credit_transactions')) charged = true;
    if (sql.includes('FROM theme_jobs')) return { rows: [job()], rowCount: 1 };
    if (sql.includes('RETURNING id')) return { rows: [{ id: jobId }], rowCount: 1 };
    if (sql.includes('FROM dictionary_items'))
      return {
        rows: [
          { id: industryId, label: '科技' },
          { id: styleId, label: '现代' },
        ],
      };
    if (sql.includes('FROM prompt_templates')) return { rows: [] };
    if (sql.includes('FROM ai_model_assignments')) return { rows: enabled ? [modelRow] : [] };
    if (sql.includes('FROM scheme_baseline_assets')) return { rows: [{ objectKey: 'source/image.png' }] };
    if (sql.includes('FROM theme_job_generated_urls')) return { rows: [...urls] };
    if (sql.includes('INSERT INTO theme_job_generated_urls')) urls.push({ ordinal: Number(params?.[1]), url: String(params?.[2]) });
    if (sql.includes('FROM theme_job_provider_attempts')) return { rows: [...attempts] };
    if (sql.includes('INSERT INTO theme_job_provider_attempts'))
      attempts.push({ id: String(params?.[0]), status: 'submitting', modelId: String(params?.[5]), revision: Number(params?.[4]) });
    if (sql.includes('UPDATE theme_job_provider_attempts')) {
      const attempt = attempts.find(a => a.id === params?.[0]);
      if (attempt) attempt.status = sql.includes("status = 'succeeded'") ? 'succeeded' : String(params?.[1]);
    }
    if (sql.includes('FROM theme_job_results'))
      return { rows: params?.length === 2 ? results.filter(r => r.ordinal === params[1]) : [...results] };
    if (sql.includes('INSERT INTO theme_job_results'))
      results.push({ resultId: String(params?.[0]), ordinal: Number(params?.[2]), previewUrl: String(params?.[4]) });
    return { rows: [], rowCount: 1 };
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => {} }) } as unknown as pg.Pool;
  const stored: string[] = [];
  const storedBytes: Buffer[] = [];
  const storage = {
    getBuffer: async () => image,
    putBuffer: async (key: string, bytes: Buffer) => {
      stored.push(key);
      storedBytes.push(bytes);
    },
    signDownload: async (key: string) => `https://assets.example/${key}`,
  };
  return {
    jobId,
    userId,
    image,
    modelRow,
    queries,
    urls,
    attempts,
    results,
    pool,
    storage,
    stored,
    storedBytes,
    state: () => status,
    disableModel: () => {
      enabled = false;
    },
  };
}

test('theme worker persists generation, accepts real images and settles once despite notification failure', async t => {
  const f = await fixture();
  const oldFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.openai.com/v1/images/edits');
    assert.ok(init!.signal);
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer api-key');
    const body = init?.body as FormData;
    assert.equal(body.get('n'), '2');
    assert.match(String(body.get('prompt')), /保持原图相机角度/);
    calls++;
    return Response.json({ data: [1, 2].map(() => ({ b64_json: f.image.toString('base64') })) });
  };
  await processThemeJob(f.pool, f.jobId, config, f.storage as never, async () => {
    throw new Error('Redis outage');
  });
  await processThemeJob(f.pool, f.jobId, config, f.storage as never);
  assert.equal(calls, 1);
  assert.equal(f.state(), 'succeeded');
  assert.equal(f.results.length, 2);
  // 每个结果一张原图加缩略图、预览图两张衍生图，衍生图记录随资产版本一并写入
  assert.deepEqual(
    f.stored.filter(key => !key.startsWith('renditions/')),
    [1, 2].map(ordinal => `theme-results/${f.jobId}/${ordinal}.png`),
  );
  assert.equal(f.stored.filter(key => key.startsWith('renditions/')).length, 4);
  const versions = f.queries.filter(q => q.sql.includes('INSERT INTO asset_versions'));
  assert.equal(versions.length, 2);
  for (const version of versions) assert.match(String(version.params?.[8]), /"preview":\{"key":"renditions\/v1\/theme-results\//);
  const charges = f.queries.filter(q => q.sql.includes('INSERT INTO credit_transactions'));
  assert.equal(charges.length, 1);
  assert.deepEqual(charges[0]?.params, [f.userId, -6, `theme_job:${f.jobId}`, f.jobId]);
  assert.ok(
    f.queries.findIndex(q => q.sql.includes('INSERT INTO theme_job_provider_attempts')) <
      f.queries.findIndex(q => q.sql.includes('INSERT INTO theme_job_generated_urls')),
  );
});

test('theme worker calls a single-image provider again until the requested count is collected', async t => {
  const f = await fixture(2, undefined, 'gemini');
  const oldFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  globalThis.fetch = async input => {
    assert.match(String(input), /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.1-flash-image:generateContent$/);
    calls++;
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: f.image.toString('base64') } }] } }],
    });
  };
  await processThemeJob(f.pool, f.jobId, config, f.storage as never);
  assert.equal(calls, 2);
  assert.equal(f.state(), 'succeeded');
  assert.equal(f.results.length, 2);
  assert.deepEqual(
    f.attempts.map(attempt => [attempt.modelId, attempt.status]),
    [
      [f.modelRow.id, 'succeeded'],
      [f.modelRow.id, 'succeeded'],
    ],
  );
});

test('a draining worker hands back a theme job before its first provider call and the next worker completes it', async t => {
  const f = await fixture(2, undefined, 'gemini');
  const oldFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: f.image.toString('base64') } }] } }],
    });
  };
  const draining = new AbortController();
  draining.abort();
  await assert.rejects(
    processThemeJob(f.pool, f.jobId, config, f.storage as never, undefined, draining.signal),
    GenerationInterruptedError,
  );
  assert.equal(calls, 0);
  assert.equal(f.attempts.length, 0);
  assert.equal(f.state(), 'running');
  assert.ok(
    f.queries.some(q => q.sql.startsWith('UPDATE theme_jobs SET lease_token = NULL')),
    'lease is released for the next worker',
  );
  await processThemeJob(f.pool, f.jobId, config, f.storage as never);
  assert.equal(calls, 2);
  assert.equal(f.state(), 'succeeded');
  assert.equal(f.results.length, 2);
});

test('a theme job that already has output keeps calling the provider while the worker drains', async t => {
  const f = await fixture(2, undefined, 'gemini');
  const oldFetch = globalThis.fetch;
  let calls = 0;
  const draining = new AbortController();
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  globalThis.fetch = async () => {
    calls++;
    draining.abort();
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: f.image.toString('base64') } }] } }],
    });
  };
  await processThemeJob(f.pool, f.jobId, config, f.storage as never, undefined, draining.signal);
  assert.equal(calls, 2);
  assert.equal(f.state(), 'succeeded');
  assert.equal(f.results.length, 2);
});

test('theme storage retry with partial generation never submits again and skips already uploaded ordinals', async t => {
  const f = await fixture(3);
  const oldFetch = globalThis.fetch;
  let calls = 0;
  let uploads = 0;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ data: [1, 2].map(() => ({ b64_json: f.image.toString('base64') })) });
  };
  const storage = {
    ...f.storage,
    putBuffer: async (key: string, bytes: Buffer) => {
      if (!key.startsWith('renditions/') && ++uploads === 2) throw new Error('Storage outage');
      await f.storage.putBuffer(key, bytes);
    },
  };
  await assert.rejects(processThemeJob(f.pool, f.jobId, config, storage as never), /Storage outage/);
  assert.equal(f.results.length, 1);
  f.disableModel();
  await processThemeJob(f.pool, f.jobId, config, storage as never);
  assert.equal(calls, 1);
  assert.equal(uploads, 3);
  assert.equal(f.results.length, 2);
  assert.equal(f.state(), 'partially_succeeded');
});

test('theme outcome-unknown retry does not call a supplier', async t => {
  const f = await fixture(1);
  f.attempts.push({ id: randomUUID(), modelId: f.modelRow.id, revision: 1, status: 'submitting' });
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  globalThis.fetch = async () => assert.fail('Must not resubmit an uncertain request');
  await processThemeJob(f.pool, f.jobId, config, f.storage as never);
  assert.equal(f.state(), 'failed');
  assert.ok(!f.queries.some(q => q.sql.includes('INSERT INTO credit_transactions')));
});

test('theme network failure records unknown outcome and never retries or switches models', async t => {
  const f = await fixture(1);
  const original = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => {
    calls++;
    throw new Error('provider network reset with secret details');
  };
  await processThemeJob(f.pool, f.jobId, config, f.storage as never);
  await processThemeJob(f.pool, f.jobId, config, f.storage as never);
  assert.equal(calls, 1);
  assert.equal(f.attempts[0]?.status, 'unknown');
  assert.equal(f.state(), 'failed');
});

test('theme worker fails without charging when no model is enabled', async () => {
  const f = await fixture(1);
  f.disableModel();
  await processThemeJob(f.pool, f.jobId, config, f.storage as never);
  assert.equal(f.state(), 'failed');
  assert.ok(!f.queries.some(q => q.sql.includes('INSERT INTO credit_transactions')));
});

test('theme worker sends the accepted prompt unchanged', async t => {
  const prompt = '已受理的提示词：主墙展示储能产品，品牌色 #123456，不要树叶。';
  const f = await fixture(1, prompt);
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  globalThis.fetch = async (_input, init) => {
    assert.equal((init!.body as FormData).get('prompt'), prompt);
    return Response.json({ data: [{ b64_json: f.image.toString('base64') }] });
  };
  await processThemeJob(f.pool, f.jobId, config, f.storage as never);
  assert.equal(f.state(), 'succeeded');
  assert.ok(!f.queries.some(q => q.sql.includes('FROM dictionary_items') || q.sql.includes('FROM prompt_templates')));
});

const options = (patch: Record<string, unknown>) => ({
  options: { sendMask: true, composite: false, backgroundMode: 'transparent', backgroundColor: '#E8EAEE', ...patch },
});

test('theme worker sends the mask only when the frozen options allow it', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  for (const sendMask of [true, false]) {
    const f = await fixture(1, '提示词', 'openai', { mask: { objectKey: 'mask.png' }, ...options({ sendMask }) });
    let sentMask: unknown;
    globalThis.fetch = async (_input, init) => {
      sentMask = (init!.body as FormData).get('mask');
      return Response.json({ data: [{ b64_json: f.image.toString('base64') }] });
    };
    await processThemeJob(f.pool, f.jobId, config, f.storage as never);
    assert.equal(f.state(), 'succeeded');
    assert.equal(sentMask !== null, sendMask);
  }
});

test('theme worker stores the composite when enabled and the provider image otherwise', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
  });
  // 蒙版没有可编辑区：合成结果应完全还原原图（#123456），未开启合成时保存模型返回的红色图。
  const generated = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#FF0000' } })
    .png()
    .toBuffer();
  for (const composite of [true, false]) {
    const f = await fixture(1, '提示词', 'openai', { mask: { objectKey: 'mask.png' }, ...options({ composite }) });
    globalThis.fetch = async () => Response.json({ data: [{ b64_json: generated.toString('base64') }] });
    await processThemeJob(f.pool, f.jobId, config, f.storage as never);
    assert.equal(f.state(), 'succeeded');
    const { data } = await sharp(f.storedBytes[0]!).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([...data.subarray(0, 3)], composite ? [0x12, 0x34, 0x56] : [0xff, 0, 0]);
  }
});
