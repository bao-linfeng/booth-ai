import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import type { Queue } from 'bullmq';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import pg from 'pg';
import sharp from 'sharp';
import { transaction } from '../src/infra/database.js';
import type { createStorage } from '../src/infra/storage.js';
import { rechargeCredits } from '../src/modules/credits/management-service.js';
import { registerAdminCreditRoutes } from '../src/http/admin/credits/index.js';
import { reconcileJobCredits } from '../src/modules/credits/reconciliation.js';
import { lockCreditUser, reserveJobCredits, releaseJobCredits, type CreditJob } from '../src/modules/credits/service.js';
import { settleThemeJob, processThemeJob } from '../src/modules/generation/theme/execution.js';
import { settleArtworkJob } from '../src/modules/generation/artwork/execution.js';
import { recoverGenerationJobs } from '../src/workers/generation-recovery.js';

test('credit invariants against PostgreSQL: rollback, concurrency, terminal recovery and recharge replay', {
  skip: !process.env.CREDIT_TEST_DATABASE_URL, timeout: 120_000,
}, async t => {
  const schema = `credits_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: process.env.CREDIT_TEST_DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.CREDIT_TEST_DATABASE_URL, options: `-c search_path=${schema}`, statement_timeout: 10_000 });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n)).sort()) {
    await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const operatorId = randomUUID();
  await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'credits-test',ARRAY['ROLE_ADMIN'])", [operatorId]);
  let externalId = 0;
  async function user(balance = 100) {
    const id = randomUUID();
    await pool.query('INSERT INTO users(id,external_user_id,username) VALUES($1,$2,$3)', [id, ++externalId, id]);
    if (balance) await rechargeCredits(pool, { userId: id, amount: balance, operatorId, requestKey: randomUUID() });
    return id;
  }
  const scheme = randomUUID();
  const source = randomUUID();
  await pool.query("INSERT INTO schemes(id,code,name) VALUES($1,'CREDIT-TEST','Credit test')", [scheme]);
  await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name) VALUES($1,$2,'rendering','source')", [source, scheme]);
  async function job(userId: string, kind: CreditJob['kind'] = 'theme', count = 1, price = 10, reserve = true): Promise<CreditJob> {
    const id = randomUUID();
    await transaction(pool, async client => {
      await lockCreditUser(client, userId);
      await client.query(`INSERT INTO ${kind}_jobs(id,user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,unit_credits)
        VALUES($1,$2,'CREDIT-TEST',$3,'offer',$6,'{}',$4,$5)`, [id, userId, source, count, price, id]);
      if (reserve) await reserveJobCredits(client, { kind, id }, userId, count * price);
    });
    return { kind, id };
  }
  const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  async function generated(task: CreditJob, count = 1, url = `data:image/png;base64,${image.toString('base64')}`) {
    for (let i = 1; i <= count; i++) await pool.query('INSERT INTO theme_job_generated_urls(job_id,ordinal,url) VALUES($1,$2,$3)', [task.id, i, url]);
  }
  async function state(task: CreditJob) {
    const current = (await pool.query(`SELECT status, usable_count FROM ${task.kind}_jobs WHERE id=$1`, [task.id])).rows[0];
    const reservation = (await pool.query(`SELECT status FROM credit_reservations WHERE ${task.kind}_job_id=$1`, [task.id])).rows[0];
    const charges = (await pool.query(`SELECT amount FROM credit_transactions WHERE ${task.kind}_job_id=$1`, [task.id])).rows;
    return { status: current.status as string, usable: current.usable_count as number, reservation: reservation?.status as string | undefined,
      charges: charges.map(row => row.amount as number) };
  }
  const config = { aiModelEncryptionKey: 'a'.repeat(64), s3: { endpoint: 'http://storage.test', publicEndpoint: 'http://public.test',
    region: 'us-east-1', bucket: 'test', accessKeyId: 'test', secretAccessKey: 'test' } };
  const storage = { putBuffer: async () => {}, signDownload: async (key: string) => `https://assets.example/${key}` } as unknown as ReturnType<typeof createStorage>;
  const run = (task: CreditJob, store = storage) => processThemeJob(pool, task.id, config, store);
  const states = new Map<string, string>();
  const enqueued: string[] = [];
  const queue = { getJob: async (id: string) => states.has(id) ? { getState: async () => states.get(id) } : undefined,
    add: async (_name: string, data: { jobId: string }) => { enqueued.push(data.jobId); states.set(data.jobId, 'waiting'); } } as unknown as Pick<Queue, 'getJob' | 'add'>;
  async function reconcile() {
    await pool.query('UPDATE theme_jobs SET credit_checked_at=NULL');
    await pool.query('UPDATE artwork_jobs SET credit_checked_at=NULL');
    await recoverGenerationJobs(pool, { theme: queue, artwork: queue });
    return reconcileJobCredits(pool, { theme: queue, artwork: queue });
  }

  await t.test('failed COMMIT preserves the full hold, blocks competing spend, and retry charges exactly once', async () => {
    const owner = await user(20); const task = await job(owner, 'theme', 2); await generated(task, 2);
    await pool.query(`CREATE FUNCTION reject_credit_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status IN ('succeeded','partially_succeeded') THEN RAISE EXCEPTION 'injected credit commit failure'; END IF; RETURN NEW; END $$;
      CREATE CONSTRAINT TRIGGER reject_credit_commit AFTER UPDATE ON theme_jobs
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_credit_commit()`);
    try { await assert.rejects(run(task), /injected credit commit failure/); }
    finally { await pool.query('DROP TRIGGER reject_credit_commit ON theme_jobs'); }
    assert.deepEqual(await state(task), { status: 'running', usable: 0, reservation: 'reserved', charges: [] });
    assert.equal((await pool.query('SELECT id FROM theme_job_results WHERE job_id=$1', [task.id])).rowCount, 2);
    await assert.rejects(job(owner), { statusCode: 402 });
    const concurrent = await Promise.allSettled([run(task), run(task)]);
    assert.ok(concurrent.some(result => result.status === 'fulfilled'));
    assert.ok(concurrent.every(result => result.status === 'fulfilled' || /GENERATION_LEASE_BUSY/.test(String(result.reason))));
    await run(task);
    assert.deepEqual(await state(task), { status: 'succeeded', usable: 2, reservation: 'settled', charges: [-20] });
    assert.equal((await pool.query('SELECT id FROM theme_job_results WHERE job_id=$1', [task.id])).rowCount, 2);
  });

  await t.test('theme and artwork reservations serialize on the same user balance', async () => {
    const owner = await user(10);
    const results = await Promise.allSettled([job(owner), job(owner, 'artwork')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected' && (r.reason as { statusCode: number }).statusCode === 402).length, 1);
    assert.equal((await pool.query("SELECT SUM(reserved_amount)::int AS held FROM credit_reservations WHERE user_id=$1 AND status='reserved'", [owner])).rows[0].held, 10);
  });

  await t.test('release rejects retryable tasks and settlement rejects prematurely released holds', async () => {
    const task = await job(await user()); await generated(task);
    await assert.rejects(transaction(pool, client => releaseJobCredits(client, task)), /Only failed jobs/);
    await pool.query("UPDATE credit_reservations SET status='released' WHERE theme_job_id=$1", [task.id]);
    await assert.rejects(run(task), /Active credit reservation required/);
    assert.equal((await state(task)).charges.length, 0);
    await reconcile();
    assert.equal((await state(task)).reservation, 'reserved');
    await run(task);
    assert.deepEqual((await state(task)).charges, [-10]);
  });

  await t.test('reconciliation never restores an old hold using money spent by a different task', async () => {
    const owner = await user(10); const old = await job(owner); await generated(old);
    await pool.query("UPDATE credit_reservations SET status='released' WHERE theme_job_id=$1", [old.id]);
    const next = await job(owner); await generated(next); await run(next);
    const report = await reconcile();
    assert.ok(report.issues.some(issue => issue.id === old.id && issue.reason === 'RESERVATION_RESTORE_INSUFFICIENT_CREDITS'));
    await assert.rejects(run(old), /Active credit reservation required/);
    assert.deepEqual((await state(old)).charges, []);
    await pool.query('DELETE FROM theme_job_results WHERE job_id=$1', [old.id]);
    await settleThemeJob(pool, old.id);
  });

  await t.test('download/upload retry exhaustion atomically releases, even after a failed failure-handler commit', async () => {
    for (const failure of ['download', 'upload']) {
      const task = await job(await user());
      await generated(task, 1, failure === 'download' ? 'https://assets.openai.com/generated.png' : undefined);
      const originalFetch = globalThis.fetch;
      if (failure === 'download') globalThis.fetch = async () => { throw new Error('download outage'); };
      const failedStorage = { ...storage, putBuffer: async () => { throw new Error('upload failed'); } } as ReturnType<typeof createStorage>;
      try { for (let i = 0; i < 3; i++) await assert.rejects(run(task, failedStorage)); }
      finally { globalThis.fetch = originalFetch; }
      assert.equal((await state(task)).reservation, 'reserved');
      await pool.query(`CREATE FUNCTION reject_failure_${failure}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.status='failed' THEN RAISE EXCEPTION 'injected failure commit'; END IF; RETURN NEW; END $$;
        CREATE CONSTRAINT TRIGGER reject_failure AFTER UPDATE ON theme_jobs
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_failure_${failure}()`);
      try { await assert.rejects(settleThemeJob(pool, task.id), /injected failure commit/); }
      finally { await pool.query('DROP TRIGGER reject_failure ON theme_jobs'); }
      assert.equal((await state(task)).reservation, 'reserved');
      await pool.query("UPDATE theme_jobs SET updated_at=now()-interval '31 minutes',execution_deadline=now()-interval '1 minute' WHERE id=$1", [task.id]);
      states.set(task.id, 'failed');
      await reconcile();
      assert.deepEqual(await state(task), { status: 'failed', usable: 0, reservation: 'released', charges: [] });
      await Promise.all([settleThemeJob(pool, task.id), run(task)]);
      assert.equal((await state(task)).charges.length, 0);
    }
  });

  await t.test('final failure cannot interrupt an active lease; expired ownership cannot be resurrected', async () => {
    const task = await job(await user()); await generated(task);
    await assert.rejects(run(task, { ...storage, putBuffer: async () => {
      await assert.rejects(settleThemeJob(pool, task.id), /GENERATION_LEASE_BUSY/);
      await pool.query("UPDATE theme_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1", [task.id]);
      await settleThemeJob(pool, task.id);
    } } as ReturnType<typeof createStorage>), /GENERATION_LEASE_LOST_OR_EXPIRED/);
    assert.deepEqual(await state(task), { status: 'failed', usable: 0, reservation: 'released', charges: [] });
    assert.equal((await pool.query('SELECT id FROM theme_job_results WHERE job_id=$1', [task.id])).rowCount, 0);
  });

  await t.test('partial success charges only usable results and releases the remainder', async () => {
    const owner = await user(20); const task = await job(owner, 'theme', 2); await generated(task);
    await run(task);
    assert.deepEqual(await state(task), { status: 'partially_succeeded', usable: 1, reservation: 'settled', charges: [-10] });
    await job(owner);
  });

  await t.test('artwork settlement rolls back debit and reservation together, then replays idempotently', async () => {
    const task = await job(await user(), 'artwork', 4);
    const asset = randomUUID(); const version = randomUUID();
    await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name,source,owner_user_id,visibility) SELECT $1,$2,'artwork','front','artwork_generation',user_id,'private' FROM artwork_jobs WHERE id=$3", [asset, scheme, task.id]);
    await pool.query("INSERT INTO asset_versions(id,asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,'front.png','front.png','image/png',10,'checksum')", [version, asset]);
    await pool.query("INSERT INTO artwork_job_results(job_id,ordinal,asset_id,asset_version_id,direction,width,height) VALUES($1,1,$2,$3,'front',1536,1024)", [task.id, asset, version]);
    await pool.query(`CREATE FUNCTION reject_artwork_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected artwork commit'; END $$;
      CREATE CONSTRAINT TRIGGER reject_artwork_commit AFTER UPDATE ON artwork_jobs
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_artwork_commit()`);
    try { await assert.rejects(settleArtworkJob(pool, task.id), /injected artwork commit/); }
    finally { await pool.query('DROP TRIGGER reject_artwork_commit ON artwork_jobs'); }
    assert.deepEqual(await state(task), { status: 'pending', usable: 0, reservation: 'reserved', charges: [] });
    await Promise.all([settleArtworkJob(pool, task.id), settleArtworkJob(pool, task.id)]);
    assert.deepEqual(await state(task), { status: 'partially_succeeded', usable: 1, reservation: 'settled', charges: [-10] });
  });

  await t.test('reconciliation repairs terminal freezes and missing holds, preserves retryable queues, and re-enqueues missing jobs', async () => {
    const owner = await user(500);
    const failed = await job(owner); await pool.query("UPDATE theme_jobs SET status='failed' WHERE id=$1", [failed.id]);
    const missing = await job(owner, 'theme', 1, 10, false);
    const successful = await job(owner); await generated(successful); await run(successful);
    await pool.query("UPDATE credit_reservations SET status='reserved' WHERE theme_job_id=$1", [successful.id]);
    const cached = await job(owner, 'theme', 1, 10, false);
    await pool.query("UPDATE theme_jobs SET cache_hit=true,status='succeeded' WHERE id=$1", [cached.id]);
    const retryable = [];
    for (const queueState of ['active', 'waiting', 'delayed', 'paused', 'waiting-children']) {
      const task = await job(owner, 'artwork', 4);
      await pool.query("UPDATE artwork_jobs SET status='running',updated_at=now()-interval '16 minutes' WHERE id=$1", [task.id]);
      states.set(task.id, queueState); retryable.push(task);
    }
    const orphan = await job(owner); await pool.query("UPDATE theme_jobs SET status='running',updated_at=now()-interval '16 minutes' WHERE id=$1", [orphan.id]);
    const exhausted = await job(owner, 'artwork', 4);
    await pool.query("UPDATE artwork_jobs SET status='running',updated_at=now()-interval '31 minutes' WHERE id=$1", [exhausted.id]);
    states.set(exhausted.id, 'failed');
    const report = await reconcile();
    assert.ok(report.repaired >= 3);
    assert.equal((await state(failed)).reservation, 'released');
    assert.equal((await state(successful)).reservation, 'settled');
    assert.equal((await state(missing)).reservation, 'reserved');
    assert.equal((await state(cached)).reservation, undefined);
    for (const task of retryable) assert.deepEqual(await state(task), { status: 'running', usable: 0, reservation: 'reserved', charges: [] });
    assert.ok(enqueued.includes(orphan.id));
    assert.deepEqual(await state(exhausted), { status: 'failed', usable: 0, reservation: 'released', charges: [] });
    assert.equal((await reconcileJobCredits(pool, { theme: queue, artwork: queue })).checked, 0);
  });

  await t.test('zero-result terminal recovery rolls back atomically, then releases theme and artwork holds idempotently', async () => {
    for (const kind of ['theme', 'artwork'] as const) {
      for (const status of ['succeeded', 'partially_succeeded']) {
        const task = await job(await user(), kind);
        await pool.query(`UPDATE ${kind}_jobs SET status=$2,lease_token=$3,lease_until=now()+interval '15 minutes' WHERE id=$1`,
          [task.id, status, randomUUID()]);
        if (kind === 'artwork') {
          await pool.query("UPDATE artwork_jobs SET delivery_status='ready' WHERE id=$1", [task.id]);
          await pool.query("INSERT INTO artwork_job_directions(job_id,direction,status,generated_url) VALUES($1,'front','succeeded','stale-url')", [task.id]);
        }
        await pool.query(`CREATE FUNCTION reject_zero_result_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.status='failed' AND OLD.status<>'failed' THEN RAISE EXCEPTION 'injected recovery commit'; END IF; RETURN NEW; END $$;
          CREATE CONSTRAINT TRIGGER reject_zero_result_recovery AFTER UPDATE ON ${kind}_jobs
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_zero_result_recovery()`);
        try {
          const report = await reconcile();
          assert.ok(report.issues.some(issue => issue.id === task.id && issue.reason === 'RECONCILIATION_FAILED'));
          assert.deepEqual(await state(task), { status, usable: 0, reservation: 'reserved', charges: [] });
          assert.equal((await pool.query(`SELECT credit_checked_at FROM ${kind}_jobs WHERE id=$1`, [task.id])).rows[0].credit_checked_at, null);
        } finally {
          await pool.query(`DROP TRIGGER reject_zero_result_recovery ON ${kind}_jobs; DROP FUNCTION reject_zero_result_recovery()`);
        }
        const report = await reconcile();
        assert.ok(!report.issues.some(issue => issue.id === task.id));
        assert.deepEqual(await state(task), { status: 'failed', usable: 0, reservation: 'released', charges: [] });
        const current = (await pool.query(`SELECT lease_token,lease_until,credit_checked_at FROM ${kind}_jobs WHERE id=$1`, [task.id])).rows[0];
        assert.equal(current.lease_token, null);
        assert.equal(current.lease_until, null);
        assert.ok(current.credit_checked_at);
        if (kind === 'artwork') {
          assert.equal((await pool.query('SELECT delivery_status FROM artwork_jobs WHERE id=$1', [task.id])).rows[0].delivery_status, 'incomplete');
          assert.deepEqual((await pool.query('SELECT status,generated_url,reason FROM artwork_job_directions WHERE job_id=$1', [task.id])).rows,
            [{ status: 'failed', generated_url: null, reason: 'PROCESSING_FAILED' }]);
        }
        await reconcile();
        assert.deepEqual(await state(task), { status: 'failed', usable: 0, reservation: 'released', charges: [] });
      }
      const missingHold = await job(await user(), kind, 1, 10, false);
      await pool.query(`UPDATE ${kind}_jobs SET status='succeeded' WHERE id=$1`, [missingHold.id]);
      await reconcile();
      assert.deepEqual(await state(missingHold), { status: 'failed', usable: 0, reservation: undefined, charges: [] });
    }
  });

  await t.test('zero-result cached jobs release stray holds without changing their terminal status', async () => {
    const task = await job(await user());
    await pool.query("UPDATE theme_jobs SET status='succeeded',cache_hit=true WHERE id=$1", [task.id]);
    const report = await reconcile();
    assert.ok(!report.issues.some(issue => issue.id === task.id));
    assert.deepEqual(await state(task), { status: 'succeeded', usable: 0, reservation: 'released', charges: [] });
    await reconcile();
    assert.deepEqual(await state(task), { status: 'succeeded', usable: 0, reservation: 'released', charges: [] });
  });

  await t.test('zero-result reconciliation preserves conflicting result and ledger evidence', async () => {
    for (const kind of ['theme', 'artwork'] as const) {
      const withResult = await job(await user(), kind);
      const asset = randomUUID();
      await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name) VALUES($1,$2,'artwork','legacy')", [asset, scheme]);
      await pool.query(`INSERT INTO ${kind}_job_results(job_id,ordinal,asset_id) VALUES($1,1,$2)`, [withResult.id, asset]);
      await pool.query(`UPDATE ${kind}_jobs SET status='succeeded' WHERE id=$1`, [withResult.id]);
      const charged = await job(await user(), kind);
      await pool.query(`UPDATE ${kind}_jobs SET status='succeeded' WHERE id=$1`, [charged.id]);
      await pool.query(`INSERT INTO credit_transactions(user_id,kind,amount,${kind}_job_id)
        SELECT user_id,$2,-10,id FROM ${kind}_jobs WHERE id=$1`, [charged.id, `${kind}_consume`]);
      const report = await reconcile();
      assert.ok(report.issues.some(issue => issue.id === withResult.id && issue.reason === 'TERMINAL_RESULT_MISMATCH'));
      assert.ok(report.issues.some(issue => issue.id === charged.id && issue.reason === 'TERMINAL_CHARGE_MISMATCH'));
      assert.deepEqual(await state(withResult), { status: 'succeeded', usable: 0, reservation: 'reserved', charges: [] });
      assert.deepEqual(await state(charged), { status: 'succeeded', usable: 0, reservation: 'reserved', charges: [-10] });
      for (const task of [withResult, charged]) {
        assert.ok((await pool.query(`SELECT credit_checked_at FROM ${kind}_jobs WHERE id=$1`, [task.id])).rows[0].credit_checked_at);
      }
    }
  });

  await t.test('concurrent recharge and lost-response retries return one immutable transaction; changed payload conflicts', async () => {
    const owner = await user(0); const other = await user(0);
    const input = { userId: owner, amount: 25, note: 'test', operatorId, requestKey: randomUUID() };
    const results = await Promise.all(Array.from({ length: 5 }, () => rechargeCredits(pool, input)));
    assert.ok(results.every(result => result.id === results[0]!.id));
    assert.equal((await rechargeCredits(pool, input)).id, results[0]!.id);
    for (const change of [{ amount: 30 }, { userId: other }, { note: 'changed' }]) {
      await assert.rejects(rechargeCredits(pool, { ...input, ...change }), { statusCode: 409, reason: 'REQUEST_CONFLICT' });
    }
    assert.equal((await pool.query('SELECT SUM(amount)::int AS balance FROM credit_transactions WHERE user_id=$1', [owner])).rows[0].balance, 25);
    await rechargeCredits(pool, { ...input, requestKey: randomUUID() });
    assert.equal((await pool.query('SELECT SUM(amount)::int AS balance FROM credit_transactions WHERE user_id=$1', [owner])).rows[0].balance, 50);
    const app = Fastify();
    const redis = { get: async () => JSON.stringify({ site: 'admin', localId: operatorId, expiresAt: Math.floor(Date.now() / 1000) + 3600 }) } as unknown as Redis;
    await registerAdminCreditRoutes(app, pool, redis);
    try {
      const { operatorId: _operator, ...body } = input;
      const options = { method: 'POST' as const, url: '/credits/recharge', headers: { authorization: 'Bearer test' } };
      const response = await app.inject({ ...options, payload: body });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().data.id, results[0]!.id);
      assert.equal((await app.inject({ ...options, payload: { userId: owner, amount: 25 } })).statusCode, 400);
      assert.equal((await app.inject({ ...options, payload: { ...body, amount: 99 } })).statusCode, 409);
    } finally { await app.close(); }
  });
});
