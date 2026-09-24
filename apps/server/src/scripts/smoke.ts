import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../config.js';
import { createDatabase, transaction } from '../infra/database.js';
import { createRedis, waitForRedis } from '../infra/redis.js';
import { createStorage } from '../infra/storage.js';
import { createQueue, TASK_NAME } from '../infra/queue.js';
import { submitEchoTask, processEchoTask, type Task } from '../modules/tasks/service.js';

const config = loadConfig();
const database = createDatabase(config);
const redis = createRedis(config);
const storage = createStorage(config);
const queue = createQueue(redis);
const probe = randomUUID();
const objectKey = `smoke/${probe}.txt`;
const redisKey = `booth:smoke:${probe}`;
let taskId: string | undefined;
let completed = false;

try {
  const api = process.env.API_BASE_URL ?? 'http://localhost:3000';
  for (const path of ['/health/live', '/health/ready', '/openapi.json', '/docs/']) {
    const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, `HTTP ${path}`);
  }
  console.info('PASS API liveness, readiness and OpenAPI');
  const version = await database.query('SHOW server_version');
  assert.ok(String(version.rows[0]?.server_version).startsWith('17.'), 'PostgreSQL major version');
  const rollbackId = randomUUID();
  await assert.rejects(transaction(database, async client => {
    await client.query('INSERT INTO foundation_tasks(id, request_key, kind, payload) VALUES ($1, $2, $3, $4)', [rollbackId, `rollback-${probe}`, TASK_NAME, { message: probe }]);
    await client.query('INSERT INTO foundation_outbox(id, task_id) VALUES ($1, $2)', [randomUUID(), rollbackId]);
    throw new Error('intentional rollback');
  }), /intentional rollback/);
  assert.equal((await database.query('SELECT id FROM foundation_tasks WHERE id = $1', [rollbackId])).rowCount, 0);
  assert.equal((await database.query('SELECT id FROM foundation_outbox WHERE task_id = $1', [rollbackId])).rowCount, 0);
  console.info('PASS PostgreSQL migration and atomic task/outbox rollback');

  await waitForRedis(redis);
  await redis.set(redisKey, probe, 'EX', 60);
  assert.equal(await redis.get(redisKey), probe);
  assert.ok((await redis.info('server')).includes('redis_version:7.4.'), 'Redis minor version');
  assert.equal((await redis.config('GET', 'maxmemory-policy'))?.[1], 'noeviction');
  console.info('PASS Redis read/write, version and noeviction');

  await storage.put(objectKey, probe);
  assert.equal(await storage.get(objectKey), probe);
  const signed = new URL(await storage.signDownload(objectKey));
  assert.equal(signed.origin, new URL(config.s3.publicEndpoint).origin);
  assert.equal(signed.pathname, `/${config.s3.bucket}/${objectKey}`);
  assert.ok(signed.searchParams.has('X-Amz-Signature'));
  await storage.delete(objectKey);
  await assert.rejects(storage.get(objectKey));
  console.info('PASS Silo upload/read/delete and public endpoint signing');

  const submissions = await Promise.all(Array.from({ length: 3 }, () => submitEchoTask(database, `smoke-${probe}`, probe)));
  taskId = submissions[0]!.id;
  assert.ok(submissions.every(task => task.id === taskId), 'Concurrent idempotent submission');
  await assert.rejects(submitEchoTask(database, `smoke-${probe}`, 'different'), /different payload/);
  for (let attempt = 0; attempt < 60; attempt++) {
    const task = (await database.query<Task>('SELECT * FROM foundation_tasks WHERE id = $1', [taskId])).rows[0]!;
    if (task.status === 'succeeded' && (await queue.getJob(taskId)) && await (await queue.getJob(taskId))!.isCompleted()) { completed = true; break; }
    assert.notEqual(task.status, 'failed', 'Worker failed foundation task');
    await delay(500);
  }
  assert.ok(completed, 'Worker did not finish task within 30 seconds');
  const task = (await database.query<Task>('SELECT * FROM foundation_tasks WHERE id = $1', [taskId])).rows[0]!;
  assert.deepEqual(task.result, { message: probe });
  const outbox = await database.query('SELECT published_at FROM foundation_outbox WHERE task_id = $1', [taskId]);
  assert.ok(outbox.rows[0]?.published_at, 'Outbox delivery not committed');
  const before = await database.query('SELECT updated_at FROM foundation_tasks WHERE id = $1', [taskId]);
  await Promise.all([processEchoTask(database, taskId), processEchoTask(database, taskId)]);
  const after = await database.query('SELECT updated_at FROM foundation_tasks WHERE id = $1', [taskId]);
  assert.deepEqual(after.rows[0], before.rows[0], 'Completed task was executed again');
  console.info('PASS DB → Outbox → BullMQ → Worker → DB, concurrent idempotency and duplicate processing');
  console.info('All foundation smoke checks passed');
} catch (error) {
  // Assertion messages contain only probe diagnostics; never emit raw SDK errors/URLs.
  console.error(error instanceof assert.AssertionError ? `Smoke assertion failed: ${error.message}` : 'Smoke failed; inspect dependency health and worker state');
  process.exitCode = 1;
} finally {
  await storage.delete(objectKey).catch(() => {});
  await redis.del(redisKey).catch(() => {});
  if (taskId && completed) {
    await (await queue.getJob(taskId))?.remove();
    await database.query('DELETE FROM foundation_tasks WHERE id = $1', [taskId]);
  }
  await queue.close();
  redis.disconnect();
  storage.close();
  await database.end();
}
