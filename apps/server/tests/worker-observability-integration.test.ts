import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { claimProjectNotifications, completeProjectNotification, failProjectNotification, PROJECT_NOTIFICATION_MAX_ATTEMPTS } from '../src/modules/projects/notifications.js';
import { refreshGeneration } from '../src/modules/generation/execution.js';
import { collectWorkerMetrics } from '../src/workers/metrics.js';

test('worker observability: notification leases, retries, dead letters, phase timing and metrics SQL', {
  skip: !process.env.PROJECT_TEST_DATABASE_URL, timeout: 60_000,
}, async t => {
  const schema = `observability_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n)).sort()) {
    await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const assignee = randomUUID(); const user = randomUUID();
  await pool.query("INSERT INTO admins(id, external_user_id, username) VALUES($1, 1, 'owner')", [assignee]);
  await pool.query("INSERT INTO users(id, external_user_id, username) VALUES($1, 1, 'customer')", [user]);
  const outbox: string[] = [];
  for (const index of [1, 2]) {
    const project = (await pool.query<{ id: string }>(`INSERT INTO projects(request_no, source_type, customer_user_id, assignee_admin_id, request_snapshot)
      VALUES($1, 'manual_request', $2, $3, '{}') RETURNING id`, [`MR-${index}`, user, assignee])).rows[0]!.id;
    const event = (await pool.query<{ id: string }>("INSERT INTO project_events(project_id, kind, payload) VALUES($1, 'accepted', '{\"revision\":1}') RETURNING id", [project])).rows[0]!.id;
    outbox.push((await pool.query<{ id: string }>('INSERT INTO project_notification_outbox(project_id, event_id) VALUES($1, $2) RETURNING id', [project, event])).rows[0]!.id);
  }

  const first = await claimProjectNotifications(pool);
  assert.equal(first.length, 2);
  assert.equal(first[0]!.attempts, 1);
  assert.equal(first[0]!.kind, 'accepted');
  assert.deepEqual(first[0]!.payload, { revision: 1 });
  assert.match(first[0]!.projectNo, /^PJ-/);
  assert.equal((await claimProjectNotifications(pool)).length, 0, 'leased events are not claimed twice');

  await completeProjectNotification(pool, first[0]!.id);
  await failProjectNotification(pool, first[1]!, 'NOTIFICATION_UNAVAILABLE');
  const retry = (await pool.query('SELECT attempts, last_error_code, locked_until, failed_at, next_attempt_at > now() AS deferred FROM project_notification_outbox WHERE id = $1', [first[1]!.id])).rows[0];
  assert.deepEqual(retry, { attempts: 1, last_error_code: 'NOTIFICATION_UNAVAILABLE', locked_until: null, failed_at: null, deferred: true });
  assert.equal((await claimProjectNotifications(pool)).length, 0, 'backoff defers the retry');

  await pool.query('UPDATE project_notification_outbox SET next_attempt_at = now(), attempts = $2 WHERE id = $1', [first[1]!.id, PROJECT_NOTIFICATION_MAX_ATTEMPTS - 1]);
  const last = await claimProjectNotifications(pool);
  assert.equal(last[0]!.attempts, PROJECT_NOTIFICATION_MAX_ATTEMPTS);
  assert.equal(await failProjectNotification(pool, last[0]!, 'NOTIFICATION_REJECTED'), true);
  await pool.query('UPDATE project_notification_outbox SET next_attempt_at = now() WHERE id = $1', [first[1]!.id]);
  assert.equal((await claimProjectNotifications(pool)).length, 0, 'dead-lettered events are not retried');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM project_notification_outbox WHERE failed_at IS NOT NULL')).rows[0].count, 1);

  const scheme = randomUUID(); const source = randomUUID(); const job = randomUUID(); const lease = randomUUID();
  await pool.query("INSERT INTO schemes(id, code, name) VALUES($1, 'OBS', 'Observability')", [scheme]);
  await pool.query("INSERT INTO scheme_assets(id, scheme_id, type, name) VALUES($1, $2, 'rendering', 'source')", [source, scheme]);
  await pool.query(`INSERT INTO theme_jobs(id, user_id, scheme_code, source_asset_id, offer_id, request_key, input, requested_count, status, lease_token,
    lease_until, execution_deadline, request_id) VALUES($1, $2, 'OBS', $3, 'o', 'k', '{}', 1, 'running', $4, now() + interval '5 minutes', now() + interval '20 minutes', 'req-1')`,
  [job, user, source, lease]);
  await refreshGeneration(pool, { kind: 'theme', id: job }, lease, 'provider_submitting');
  const started = (await pool.query('SELECT phase, phase_started_at FROM theme_jobs WHERE id = $1', [job])).rows[0];
  assert.equal(started.phase, 'provider_submitting');
  assert.ok(started.phase_started_at);
  await refreshGeneration(pool, { kind: 'theme', id: job }, lease, 'provider_submitting');
  assert.deepEqual((await pool.query('SELECT phase_started_at FROM theme_jobs WHERE id = $1', [job])).rows[0].phase_started_at, started.phase_started_at,
    'refreshing the same phase keeps its start time');
  await refreshGeneration(pool, { kind: 'theme', id: job }, lease, 'result_validating');
  assert.notDeepEqual((await pool.query('SELECT phase_started_at FROM theme_jobs WHERE id = $1', [job])).rows[0].phase_started_at, started.phase_started_at);
  await assert.rejects(refreshGeneration(pool, { kind: 'theme', id: job }, randomUUID(), 'result_validating'), /GENERATION_LEASE_LOST_OR_EXPIRED/);

  await pool.query("INSERT INTO credit_transactions(user_id, kind, amount) VALUES($1, 'recharge', 100)", [user]);
  await pool.query('INSERT INTO credit_reservations(user_id, theme_job_id, reserved_amount) VALUES($1, $2, 10)', [user, job]);
  await pool.query("UPDATE theme_jobs SET execution_deadline = now() - interval '1 minute' WHERE id = $1", [job]);
  await pool.query('INSERT INTO theme_job_outbox(job_id) VALUES($1)', [job]);
  const counts = { waiting: 1, active: 0, delayed: 0, failed: 0, prioritized: 0 };
  const metrics = await collectWorkerMetrics(pool, { theme: { getJobCounts: async () => counts } });
  assert.deepEqual(metrics.queues, { theme: counts });
  assert.equal(metrics.outbox.theme?.pending, 1);
  assert.equal(metrics.outbox.foundation?.pending, 0);
  assert.equal(metrics.outbox.project_notification?.pending, 0);
  assert.equal(metrics.projectNotificationsFailed, 1);
  assert.equal(metrics.overdueCreditReservations, 1);
  assert.deepEqual(metrics.runningPhases.map(row => [row.kind, row.phase, row.jobs]), [['theme', 'result_validating', 1]]);
});
