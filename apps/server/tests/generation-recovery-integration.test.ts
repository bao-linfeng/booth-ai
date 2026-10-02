import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import type { Queue } from 'bullmq';
import pg from 'pg';
import sharp from 'sharp';
import { findModelDefinition } from '../src/infra/ai/catalog.js';
import { encryptCredential } from '../src/infra/ai/config.js';
import type { createStorage } from '../src/infra/storage.js';
import { transaction } from '../src/infra/database.js';
import { reserveJobCredits } from '../src/modules/credits/service.js';
import { processThemeJob } from '../src/modules/generation/theme/execution.js';
import { recoverGenerationJobs } from '../src/workers/generation-recovery.js';

test('generation recovery: durable submissions, partial uploads, lease exclusion, async polling and deadline settlement', {
  skip: !process.env.THEME_TEST_DATABASE_URL, timeout: 60_000,
}, async t => {
  const schema = `generation_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.THEME_TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.THEME_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n)).sort()) {
    await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const user = randomUUID(); const scheme = randomUUID(); const source = randomUUID();
  const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  const checksum = createHash('sha256').update(image).digest('hex');
  const key = 'a'.repeat(64);
  await pool.query("INSERT INTO users(id, external_user_id, username) VALUES($1,1,'generation')", [user]);
  await pool.query("INSERT INTO credit_transactions(user_id,kind,amount) VALUES($1,'recharge',1000)", [user]);
  await pool.query("INSERT INTO schemes(id,code,name) VALUES($1,'RECOVERY','Recovery')", [scheme]);
  await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name) VALUES($1,$2,'rendering','source')", [source, scheme]);
  const version = (await pool.query<{ id: string }>(`INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum)
    VALUES($1,'source.png','source.png','image/png',$2,$3) RETURNING id`, [source, image.length, checksum])).rows[0]!.id;
  for (const provider of ['openai', 'wanx', 'gemini'] as const) await pool.query(`UPDATE ai_model_configs SET enabled=true,unit_credits=3,credential_ciphertext=$2
    WHERE purpose='theme' AND provider=$1`, [provider, encryptCredential('secret-provider-key', provider, key)]);
  const config = { aiModelEncryptionKey: key, s3: { endpoint: 'http://silo:9000', publicEndpoint: 'http://localhost:19000',
    region: 'us-east-1', bucket: 'booth-assets', accessKeyId: 'test', secretAccessKey: 'test' } };
  const storage = { getBuffer: async () => image, putBuffer: async () => {}, signDownload: async (objectKey: string) => `https://assets.example/${objectKey}` } as unknown as ReturnType<typeof createStorage>;
  async function seed(count = 3, provider: 'openai' | 'wanx' | 'gemini' = 'openai') {
    const id = randomUUID();
    await transaction(pool, async client => {
      await client.query(`INSERT INTO theme_jobs(id,user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,unit_credits,generation_snapshot)
        VALUES($1::uuid,$2,'RECOVERY',$3,'offer',$1::text,'{}',$4,3,$5)`, [id, user, source, count, JSON.stringify({ prompt: 'frozen prompt', mask: null,
        source: { assetId: source, versionId: version, objectKey: 'source.png', checksum }, models: [{ provider, model: findModelDefinition('theme', provider)!.model, revision: 1 }] })]);
      await reserveJobCredits(client, { kind: 'theme', id }, user, count * 3);
    });
    return id;
  }
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ data: [1, 2].map(() => ({ b64_json: image.toString('base64') })) }); };
  const partial = await seed(); let uploads = 0;
  const failingStorage = { ...storage, putBuffer: async () => { if (++uploads === 2) throw new Error('storage outage'); } };
  await assert.rejects(processThemeJob(pool, partial, config, failingStorage), /storage outage/);
  assert.equal((await pool.query('SELECT id FROM theme_job_results WHERE job_id=$1', [partial])).rowCount, 1);
  await processThemeJob(pool, partial, config, failingStorage, async () => { throw new Error('notification outage'); });
  assert.equal(calls, 1); assert.equal(uploads, 3);
  assert.equal((await pool.query('SELECT status FROM theme_jobs WHERE id=$1', [partial])).rows[0].status, 'partially_succeeded');
  assert.deepEqual((await pool.query('SELECT amount FROM credit_transactions WHERE theme_job_id=$1', [partial])).rows, [{ amount: -6 }]);
  assert.deepEqual((await pool.query('SELECT width,height FROM theme_job_results WHERE job_id=$1 ORDER BY ordinal', [partial])).rows,
    [{ width: 64, height: 64 }, { width: 64, height: 64 }]);

  const uncertain = await seed(1);
  await pool.query(`INSERT INTO theme_job_provider_attempts(id,job_id,provider,model,revision,status)
    VALUES($1,$2,'openai',$3,1,'submitting')`, [randomUUID(), uncertain, findModelDefinition('theme', 'openai')!.model]);
  await processThemeJob(pool, uncertain, config, storage);
  assert.equal(calls, 1);
  assert.equal((await pool.query('SELECT status,reason FROM theme_job_provider_attempts WHERE job_id=$1', [uncertain])).rows[0].reason, 'PROVIDER_OUTCOME_UNKNOWN');

  const concurrent = await seed(1); let unblock!: () => void; let entered!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  globalThis.fetch = async () => { calls++; entered(); await blocked; return Response.json({ data: [{ b64_json: image.toString('base64') }] }); };
  const running = processThemeJob(pool, concurrent, config, storage); await started;
  await assert.rejects(processThemeJob(pool, concurrent, config, storage), /GENERATION_LEASE_BUSY/); unblock(); await running;
  assert.equal(calls, 2);

  const waiting = await seed(1, 'wanx');
  await pool.query(`INSERT INTO theme_job_provider_attempts(id,job_id,provider,model,revision,status,provider_task_id)
    VALUES($1,$2,'wanx',$3,1,'waiting','persisted-task')`, [randomUUID(), waiting, findModelDefinition('theme', 'wanx')!.model]);
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://dashscope.aliyuncs.com/api/v1/tasks/persisted-task'); assert.ok(init?.signal);
    return Response.json({ output: { task_status: 'SUCCEEDED', results: [{ url: `data:image/png;base64,${image.toString('base64')}` }] } });
  };
  await processThemeJob(pool, waiting, config, storage);
  assert.equal((await pool.query('SELECT status FROM theme_jobs WHERE id=$1', [waiting])).rows[0].status, 'succeeded');

  const expired = await seed(2); let fail = true;
  globalThis.fetch = async () => Response.json({ data: [1, 2].map(() => ({ b64_json: image.toString('base64') })) });
  await assert.rejects(processThemeJob(pool, expired, config, { ...storage, putBuffer: async () => {
    if (!fail) throw new Error('second upload failed'); fail = false;
  } }), /second upload failed/);
  await pool.query("UPDATE theme_jobs SET execution_deadline=now()-interval '1 minute',lease_until=now()-interval '1 minute' WHERE id=$1", [expired]);
  const resumed = await seed(1);
  await pool.query("UPDATE theme_jobs SET status='running',updated_at=now()-interval '16 minutes' WHERE id=$1", [resumed]);
  const requeued: string[] = [];
  const queue = { getJob: async (id: string) => id === resumed ? { getState: async () => 'completed', retry: async () => { requeued.push(id); } } : undefined,
    add: async (_name: string, data: { jobId: string }) => { requeued.push(data.jobId); } } as unknown as Pick<Queue, 'getJob' | 'add'>;
  await recoverGenerationJobs(pool, { theme: queue, artwork: queue });
  assert.deepEqual(requeued, [resumed]);
  assert.equal((await pool.query('SELECT status,usable_count FROM theme_jobs WHERE id=$1', [expired])).rows[0].status, 'partially_succeeded');
  assert.deepEqual((await pool.query('SELECT amount FROM credit_transactions WHERE theme_job_id=$1', [expired])).rows, [{ amount: -3 }]);

  const gemini = await seed(2, 'gemini'); let geminiCalls = 0;
  globalThis.fetch = async () => {
    if (++geminiCalls === 2) throw new Error('second request outcome unknown');
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] } }] });
  };
  await processThemeJob(pool, gemini, config, storage);
  assert.equal(geminiCalls, 2);
  assert.equal((await pool.query('SELECT status,usable_count FROM theme_jobs WHERE id=$1', [gemini])).rows[0].status, 'partially_succeeded');
  assert.equal((await pool.query('SELECT id FROM theme_job_generated_urls WHERE job_id=$1', [gemini])).rowCount, 1);

  const submitted = await seed(1, 'wanx'); let submissions = 0; let pollUnavailable = true;
  globalThis.fetch = async (input) => {
    if (String(input).includes('image-synthesis')) { submissions++; return Response.json({ output: { task_id: 'submitted-once' } }); }
    assert.equal(String(input), 'https://dashscope.aliyuncs.com/api/v1/tasks/submitted-once');
    if (pollUnavailable) return new Response('unavailable', { status: 503 });
    return Response.json({ output: { task_status: 'SUCCEEDED', results: [{ url: `data:image/png;base64,${image.toString('base64')}` }] } });
  };
  await assert.rejects(processThemeJob(pool, submitted, config, storage), /PROVIDER_REQUEST_FAILED/);
  assert.equal((await pool.query('SELECT status,provider_task_id FROM theme_job_provider_attempts WHERE job_id=$1', [submitted])).rows[0].status, 'waiting');
  pollUnavailable = false;
  await processThemeJob(pool, submitted, config, storage);
  assert.equal(submissions, 1);
  assert.equal((await pool.query('SELECT status FROM theme_jobs WHERE id=$1', [submitted])).rows[0].status, 'succeeded');
});
