import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type pg from 'pg';
import { loadConfig } from '../src/config.js';
import type { Logger } from '../src/infra/logger.js';
import { errorCode } from '../src/infra/logger.js';
import { providerRequestId } from '../src/infra/ai/image.js';
import { migrationReadiness, readMigrations } from '../src/infra/migrations.js';
import { createWebhookSender, WebhookDeliveryError } from '../src/infra/webhook.js';
import { PROJECT_NOTIFICATION_MAX_ATTEMPTS, projectNotificationBackoffSeconds } from '../src/modules/projects/notifications.js';
import { createJobStats } from '../src/workers/metrics.js';
import { deliverProjectNotifications } from '../src/workers/project-notifications.js';
import { createScheduler } from '../src/workers/scheduler.js';

function recordingLogger() {
  const entries: { level: string; data: unknown; message?: string }[] = [];
  const at = (level: string) => (data: unknown, message?: string) => { entries.push({ level, data, ...(message ? { message } : {}) }); };
  const log = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => log } as unknown as Logger;
  return { log, entries };
}

test('scheduler isolates task failures so later dispatchers still run', async () => {
  const ran: string[] = [];
  const { log } = recordingLogger();
  const scheduler = createScheduler([
    { name: 'broken', intervalMs: 1000, staleAfterMs: 30_000, run: async () => { ran.push('broken'); throw Object.assign(new Error('redis down'), { code: 'ECONNREFUSED' }); } },
    { name: 'healthy', intervalMs: 1000, staleAfterMs: 30_000, run: async () => { ran.push('healthy'); } },
  ], log);
  await scheduler.tick();
  assert.deepEqual(ran, ['broken', 'healthy']);
  const report = scheduler.health({ worker: true });
  assert.equal(report.healthy, false);
  assert.deepEqual(report.problems, ['task:broken']);
  assert.equal(report.tasks.broken?.lastErrorCode, 'ECONNREFUSED');
  assert.equal(report.tasks.broken?.consecutiveFailures, 1);
  assert.equal(report.tasks.healthy?.stale, false);
});

test('scheduler health covers every consumer, staleness and non-critical tasks', async () => {
  let clock = 1_000_000;
  const { log } = recordingLogger();
  let fail = false;
  const scheduler = createScheduler([
    { name: 'dispatch', intervalMs: 1000, staleAfterMs: 30_000, run: async () => { if (fail) throw new Error('x'); } },
    { name: 'metrics', intervalMs: 60_000, staleAfterMs: 1, critical: false, run: async () => { throw new Error('metrics unavailable'); } },
  ], log, () => clock);
  assert.equal(scheduler.health({}).healthy, false, 'unhealthy before the first successful run');
  await scheduler.tick();
  assert.equal(scheduler.health({ foundation: true, theme: true, artwork: true }).healthy, true);
  assert.deepEqual(scheduler.health({ foundation: true, theme: false, artwork: true }).problems, ['consumer:theme']);
  fail = true;
  clock += 31_000;
  await scheduler.tick();
  assert.deepEqual(scheduler.health({}).problems, ['task:dispatch']);
  fail = false;
  clock += 1000;
  await scheduler.tick();
  assert.equal(scheduler.health({}).healthy, true);
});

test('scheduler honours intervals and throttles repeated failure logs', async () => {
  let clock = 0;
  let runs = 0;
  const { log, entries } = recordingLogger();
  const scheduler = createScheduler([{ name: 'slow', intervalMs: 60_000, staleAfterMs: 300_000, run: async () => { runs++; throw new Error('down'); } }], log, () => clock);
  await scheduler.tick();
  clock += 1000;
  await scheduler.tick();
  assert.equal(runs, 1);
  for (let index = 0; index < 120; index++) { clock += 60_000; await scheduler.tick(); }
  assert.equal(runs, 121);
  assert.equal(entries.filter(entry => entry.level === 'error').length, 3);
});

test('migration readiness requires every bundled migration with matching checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booth-migrations-'));
  try {
    await writeFile(join(directory, '001_a.sql'), 'SELECT 1;');
    await writeFile(join(directory, '002_b.sql'), 'SELECT 2;');
    await writeFile(join(directory, 'notes.md'), 'ignored');
    const expected = await readMigrations(directory);
    assert.deepEqual(expected.map(migration => migration.version), ['001_a.sql', '002_b.sql']);
    let applied = expected.map(({ version, checksum }) => ({ version, checksum }));
    const database = { query: async () => ({ rows: applied }) } as unknown as pg.Pool;
    const check = migrationReadiness(database, expected);
    await check();
    applied = applied.slice(0, 1);
    await assert.rejects(check(), /Migration missing/);
    applied = [applied[0]!, { version: '002_b.sql', checksum: 'tampered' }];
    await assert.rejects(check(), /Migration missing/);
    assert.throws(() => migrationReadiness(database, []), /No migrations/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the repository migrations are readable for readiness', async () => {
  const migrations = await readMigrations();
  assert.ok(migrations.some(migration => migration.version === '053_project_notification_delivery.sql'));
});

function notificationDatabase(rows: { id: string; attempts: number }[]) {
  const updates: { sql: string; params: unknown[] }[] = [];
  const database = { query: async (sql: string, params: unknown[]) => {
    if (sql.includes('UPDATE project_notification_outbox o SET attempts')) {
      return { rows: rows.map(row => ({ ...row, eventId: `event-${row.id}`, projectId: 'project-1', projectNo: 'P-1', sourceType: 'quote_request',
        kind: 'accepted', payload: { revision: 1 }, occurredAt: new Date('2026-01-01T00:00:00Z') })) };
    }
    updates.push({ sql, params });
    return { rows: [], rowCount: 1 };
  } } as unknown as pg.Pool;
  return { database, updates };
}

test('project notifications deliver, retry with backoff and dead-letter after the attempt budget', async () => {
  const { database, updates } = notificationDatabase([{ id: 'a', attempts: 1 }, { id: 'b', attempts: 2 }, { id: 'c', attempts: PROJECT_NOTIFICATION_MAX_ATTEMPTS }]);
  const sent: { id: string; body: unknown }[] = [];
  const { log, entries } = recordingLogger();
  const result = await deliverProjectNotifications(database, async message => {
    sent.push(message);
    if (message.id !== 'event-a') throw new WebhookDeliveryError('NOTIFICATION_UNAVAILABLE');
  }, log);
  assert.deepEqual(result, { delivered: 1, failed: 2 });
  assert.deepEqual(sent[0], { id: 'event-a', body: { eventId: 'event-a', projectId: 'project-1', projectNo: 'P-1', sourceType: 'quote_request',
    kind: 'accepted', payload: { revision: 1 }, occurredAt: '2026-01-01T00:00:00.000Z' } });
  assert.match(updates[0]!.sql, /delivered_at = now\(\)/);
  assert.deepEqual(updates[1]!.params, ['b', 'NOTIFICATION_UNAVAILABLE', projectNotificationBackoffSeconds(2), false]);
  assert.deepEqual(updates[2]!.params, ['c', 'NOTIFICATION_UNAVAILABLE', projectNotificationBackoffSeconds(PROJECT_NOTIFICATION_MAX_ATTEMPTS), true]);
  assert.equal(entries.filter(entry => entry.level === 'error').length, 1);
  assert.equal(projectNotificationBackoffSeconds(1), 30);
  assert.equal(projectNotificationBackoffSeconds(20), 3600);
});

test('webhook sender signs payloads and classifies failures without leaking responses', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let status = 204;
  const sender = createWebhookSender({ url: 'https://hooks.example.com/booth', secret: 's'.repeat(32) }, (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : 'secret upstream detail', { status });
  }) as typeof fetch);
  await sender({ id: 'event-1', body: { a: 1 } });
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers['x-booth-event-id'], 'event-1');
  const expected = createHmac('sha256', 's'.repeat(32)).update(`${headers['x-booth-timestamp']}.{"a":1}`).digest('hex');
  assert.equal(headers['x-booth-signature'], `sha256=${expected}`);
  status = 503;
  await assert.rejects(sender({ id: 'e', body: {} }), (error: unknown) => errorCode(error) === 'NOTIFICATION_UNAVAILABLE');
  status = 400;
  await assert.rejects(sender({ id: 'e', body: {} }), (error: unknown) => errorCode(error) === 'NOTIFICATION_REJECTED');
  const offline = createWebhookSender({ url: 'https://hooks.example.com', secret: 's'.repeat(32) }, (async () => { throw new Error('getaddrinfo https://user:pass@x'); }) as typeof fetch);
  await assert.rejects(offline({ id: 'e', body: {} }), (error: unknown) => error instanceof Error && error.message === 'NOTIFICATION_UNAVAILABLE');
});

test('notification webhook config is optional but validated when present', () => {
  const base = { DATABASE_URL: 'postgres://u:p@db/booth', REDIS_URL: 'redis://redis', EXTERNAL_API_URL: 'https://auth.example.com', SESSION_SECRET: 'x'.repeat(32),
    AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), S3_ENDPOINT: 'http://silo:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'b', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's' };
  assert.equal(loadConfig(base).projectNotificationWebhook, undefined);
  assert.throws(() => loadConfig({ ...base, PROJECT_NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.com' }), /PROJECT_NOTIFICATION_WEBHOOK_SECRET/);
  assert.throws(() => loadConfig({ ...base, PROJECT_NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.com', PROJECT_NOTIFICATION_WEBHOOK_SECRET: 'short' }), /Invalid PROJECT_NOTIFICATION_WEBHOOK_SECRET/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', PROJECT_NOTIFICATION_WEBHOOK_URL: 'http://hooks.example.com', PROJECT_NOTIFICATION_WEBHOOK_SECRET: 'z'.repeat(32) }), /PROJECT_NOTIFICATION_WEBHOOK_URL/);
  assert.deepEqual(loadConfig({ ...base, PROJECT_NOTIFICATION_WEBHOOK_URL: 'https://hooks.example.com', PROJECT_NOTIFICATION_WEBHOOK_SECRET: 'z'.repeat(32) }).projectNotificationWebhook,
    { url: 'https://hooks.example.com', secret: 'z'.repeat(32) });
});

test('provider request ids are extracted from headers or bodies and sanitised', () => {
  const headers = (value: string | null) => ({ get: (name: string) => name === 'x-request-id' ? value : null });
  assert.equal(providerRequestId(headers('req_abc123'), undefined), 'req_abc123');
  assert.equal(providerRequestId(headers(null), { request_id: 'b7c1-22' }), 'b7c1-22');
  assert.equal(providerRequestId(headers(null), { responseId: 'gem.1' }), 'gem.1');
  assert.equal(providerRequestId(headers('bad value with spaces'), undefined), undefined);
  assert.equal(providerRequestId(headers('x'.repeat(129)), undefined), undefined);
});

test('job stats report queue wait and run time per window', () => {
  const stats = createJobStats();
  stats.record('theme', 'completed', 100, 1000);
  stats.record('theme', 'failed', 300, 3000);
  assert.deepEqual(stats.drain(), { theme: { completed: 1, failed: 1, waitMsAvg: 200, waitMsMax: 300, runMsAvg: 2000, runMsMax: 3000 } });
  assert.deepEqual(stats.drain(), {});
});
