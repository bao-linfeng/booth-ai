import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { THEME_TASK_NAME } from '../src/infra/queue.js';
import { dispatchThemeOutbox, reconcileThemeOutbox } from '../src/modules/tasks/theme-outbox.js';
import { failThemeJob } from '../src/modules/tasks/theme-worker.js';

test('theme outbox delivery and recovery against PostgreSQL and Redis', {
  skip: !process.env.THEME_TEST_DATABASE_URL || !process.env.THEME_TEST_REDIS_URL,
  timeout: 90_000,
}, async t => {
  const schema = `theme_outbox_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.THEME_TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const database = new pg.Pool({ connectionString: process.env.THEME_TEST_DATABASE_URL, options: `-c search_path=${schema}`, statement_timeout: 5000 });
  const redis = new Redis(process.env.THEME_TEST_REDIS_URL!, { maxRetriesPerRequest: 1, commandTimeout: 5000 });
  const queue = new Queue(schema, { connection: redis });
  t.after(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    redis.disconnect();
    await database.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  for (const migration of ['002_auth', '030_credits', '031_theme_jobs', '032_theme_job_results', '038_credit_reservations_and_generated_urls', '039_credit_idempotency', '046_theme_outbox_reconciliation']) {
    await database.query(await readFile(new URL(`../migrations/${migration}.sql`, import.meta.url), 'utf8'));
  }
  await database.query('ALTER TABLE theme_jobs ADD COLUMN cache_hit boolean NOT NULL DEFAULT false');
  const userId = randomUUID();
  await database.query("INSERT INTO users(id, external_user_id, username) VALUES ($1, 1, 'outbox-test')", [userId]);

  async function seed(status = 'pending', outbox: 'unpicked' | 'picked' | 'missing' = 'unpicked', stale = false) {
    const id = randomUUID();
    await database.query(
      `INSERT INTO theme_jobs(id, user_id, scheme_code, source_asset_id, offer_id, request_key, input, requested_count, status, updated_at)
       VALUES ($1::uuid, $2, 'S-1', $1::uuid, 'offer', $1::text, '{}', 1, $3, now() - $4::interval)`,
      [id, userId, status, stale ? '16 minutes' : '0 minutes'],
    );
    if (outbox !== 'missing') await database.query(
      'INSERT INTO theme_job_outbox(job_id, picked_at) VALUES ($1, CASE WHEN $2 THEN now() ELSE NULL END)', [id, outbox === 'picked'],
    );
    await database.query('INSERT INTO credit_reservations(user_id, theme_job_id, reserved_amount) VALUES ($1, $2, 10)', [userId, id]);
    return id;
  }
  async function state(id: string) {
    return (await database.query(
      `SELECT j.status, o.picked_at, r.status AS reservation FROM theme_jobs j
       LEFT JOIN theme_job_outbox o ON o.job_id = j.id
       JOIN credit_reservations r ON r.theme_job_id = j.id WHERE j.id = $1`, [id],
    )).rows[0] as { status: string; picked_at: Date | null; reservation: string };
  }
  async function reset() {
    await database.query('DELETE FROM theme_jobs');
    await queue.obliterate({ force: true });
  }

  await t.test('Redis enqueue failure leaves the transaction retryable', async () => {
    const id = await seed();
    const offline = new Redis(process.env.THEME_TEST_REDIS_URL!, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    const unavailable = new Queue(`${schema}_offline`, { connection: offline, skipWaitingForReady: true });
    unavailable.on('error', () => {});
    offline.disconnect();
    try {
      await assert.rejects(dispatchThemeOutbox(database, { getJob: async () => undefined, add: unavailable.add.bind(unavailable) }));
    } finally {
      await unavailable.close();
    }
    assert.deepEqual(await state(id), { status: 'pending', picked_at: null, reservation: 'reserved' });
    await dispatchThemeOutbox(database, queue);
    assert.equal((await state(id)).status, 'queued');
    assert.equal(await queue.getWaitingCount(), 1);
    await reset();
  });

  await t.test('enqueue success followed by PostgreSQL COMMIT failure reuses the same queue job', async () => {
    const id = await seed();
    await database.query(`CREATE FUNCTION reject_publish() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected commit failure'; END $$;
      CREATE CONSTRAINT TRIGGER reject_publish AFTER UPDATE ON theme_job_outbox
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_publish()`);
    await assert.rejects(dispatchThemeOutbox(database, queue), /injected commit failure/);
    assert.deepEqual(await state(id), { status: 'pending', picked_at: null, reservation: 'reserved' });
    assert.equal(await queue.getWaitingCount(), 1);
    await database.query('DROP TRIGGER reject_publish ON theme_job_outbox');
    await dispatchThemeOutbox(database, queue);
    assert.equal(await queue.getWaitingCount(), 1);
    assert.ok((await state(id)).picked_at);
    await reset();
  });

  for (const stage of ['before-add', 'after-add']) {
    await t.test(`dispatcher process killed ${stage} recovers on restart`, async () => {
      const id = await seed();
      const child = fork(new URL('./fixtures/theme-outbox-process.ts', import.meta.url), [], {
        env: { ...process.env, THEME_TEST_SCHEMA: schema, THEME_TEST_QUEUE: schema, THEME_TEST_CRASH_STAGE: stage },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      try {
        await once(child, 'message', { signal: AbortSignal.timeout(15_000) });
        assert.deepEqual(await state(id), { status: 'pending', picked_at: null, reservation: 'reserved' });
        const exit = once(child, 'exit');
        child.kill('SIGKILL');
        await exit;
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      assert.equal(await queue.getWaitingCount(), stage === 'after-add' ? 1 : 0);
      await database.query('SELECT id FROM theme_jobs WHERE id = $1 FOR UPDATE', [id]);
      await dispatchThemeOutbox(database, queue);
      assert.equal(await queue.getWaitingCount(), 1);
      assert.equal((await state(id)).status, 'queued');
      await reset();
    });
  }

  await t.test('concurrent dispatchers skip locked rows and a consumer cannot start before commit', async () => {
    const id = await seed();
    let signalAdded!: () => void;
    let resumeDispatch!: () => void;
    const added = new Promise<void>(resolve => { signalAdded = resolve; });
    const resume = new Promise<void>(resolve => { resumeDispatch = resolve; });
    const first = dispatchThemeOutbox(database, {
      getJob: queue.getJob.bind(queue),
      add: async (...args: Parameters<Queue['add']>) => {
        const job = await queue.add(...args);
        signalAdded();
        await resume;
        return job;
      },
    });
    await added;
    try {
      await dispatchThemeOutbox(database, { getJob: async () => assert.fail('row must be skipped'), add: queue.add.bind(queue) });
      const consumer = await database.connect();
      try {
        await consumer.query('BEGIN');
        await consumer.query("SET LOCAL lock_timeout = '100ms'");
        await assert.rejects(consumer.query("UPDATE theme_jobs SET status = 'running' WHERE id = $1", [id]), /lock timeout/);
        await consumer.query('ROLLBACK');
      } finally { consumer.release(); }
    } finally { resumeDispatch(); await first; }
    assert.equal(await queue.getWaitingCount(), 1);
    await reset();
  });

  await t.test('reconciliation repairs lost publications and missing outbox rows, preserving reservations', async () => {
    const queued = await seed('queued', 'picked', true);
    const missing = await seed('pending', 'missing', true);
    const fresh = await seed('queued', 'picked');
    const excluded = await Promise.all(['running', 'settling', 'succeeded', 'partially_succeeded', 'failed'].map(status => seed(status, 'picked', true)));
    assert.equal(await reconcileThemeOutbox(database), 2);
    assert.equal(await reconcileThemeOutbox(database), 0);
    await dispatchThemeOutbox(database, queue);
    for (const id of [queued, missing]) {
      assert.equal((await state(id)).status, 'queued');
      assert.equal((await state(id)).reservation, 'reserved');
      assert.equal((await queue.getJob(id))?.id, id);
    }
    for (const id of [fresh, ...excluded]) assert.equal(await queue.getJob(id), undefined);
    await reset();
  });

  for (const terminal of ['completed', 'failed'] as const) {
    await t.test(`recovery restarts a retained ${terminal} BullMQ record`, async () => {
      const id = await seed('queued', 'picked', true);
      const consumer = new Redis(process.env.THEME_TEST_REDIS_URL!, { maxRetriesPerRequest: null });
      const worker = new Worker(schema, async () => { if (terminal === 'failed') throw new Error('injected worker failure'); }, { connection: consumer });
      try {
        const finished = once(worker, terminal, { signal: AbortSignal.timeout(10_000) });
        await queue.add(THEME_TASK_NAME, { jobId: id }, { jobId: id, attempts: 1 });
        await finished;
      } finally { await worker.close(); consumer.disconnect(); }
      assert.equal(await (await queue.getJob(id))?.getState(), terminal);
      assert.equal(await reconcileThemeOutbox(database), 1);
      await dispatchThemeOutbox(database, queue);
      assert.equal(await (await queue.getJob(id))?.getState(), 'waiting');
      assert.equal((await state(id)).reservation, 'reserved');
      await reset();
    });
  }

  await t.test('failure status and reservation release roll back together and successful jobs are protected', async () => {
    const id = await seed('running', 'picked');
    await database.query(`CREATE FUNCTION reject_release() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected release failure'; END $$;
      CREATE TRIGGER reject_release BEFORE UPDATE ON credit_reservations
      FOR EACH ROW EXECUTE FUNCTION reject_release()`);
    await assert.rejects(failThemeJob(database, id), /injected release failure/);
    assert.equal((await state(id)).status, 'running');
    assert.equal((await state(id)).reservation, 'reserved');
    await database.query('DROP TRIGGER reject_release ON credit_reservations');
    await failThemeJob(database, id);
    await failThemeJob(database, id);
    assert.equal((await state(id)).status, 'failed');
    assert.equal((await state(id)).reservation, 'released');
    for (const status of ['succeeded', 'partially_succeeded']) {
      const success = await seed(status, 'picked');
      await database.query("UPDATE credit_reservations SET status = 'settled' WHERE theme_job_id = $1", [success]);
      await failThemeJob(database, success);
      assert.equal((await state(success)).status, status);
      assert.equal((await state(success)).reservation, 'settled');
    }
    await reset();
  });
});
