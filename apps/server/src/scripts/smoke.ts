import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../config.js';
import { createDatabase, transaction } from '../infra/database.js';
import { createRedis, waitForRedis } from '../infra/redis.js';
import { createStorage } from '../infra/storage.js';
import { createQueue, TASK_NAME } from '../infra/queue.js';
import { submitEchoTask, processEchoTask, type Task } from '../modules/tasks/service.js';
import { createSession, encryptJwt } from '../infra/session.js';

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
// 客服链路创建的临时坐席、访客与会话，结束时清理
const cs = { roleId: null as number | null, adminId: null as string | null, visitorId: null as string | null, conversationId: null as string | null };

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
  assert.equal(((await redis.config('GET', 'maxmemory-policy')) as string[])[1], 'noeviction');
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
  await customerServiceSmoke(api);
  console.info('PASS customer service: visitor → conversation → claim → reply over SSE → close');
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
  await cleanupCustomerService().catch(() => console.error('Customer service smoke cleanup failed'));
  await queue.close();
  redis.disconnect();
  storage.close();
  await database.end();
}

type Envelope<T> = { code: number; data: T };
async function call<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; data: T }> {
  const { json, ...rest } = init;
  const response = await fetch(url, { ...rest, signal: AbortSignal.timeout(10_000),
    ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { 'content-type': 'application/json', ...rest.headers } }) });
  const body = await response.json() as Envelope<T>;
  return { status: response.status, data: body.data };
}

/** 读取 SSE 直到出现满足条件的事件 */
async function waitForEvent(response: Response, match: (event: Record<string, unknown>) => boolean): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const next = await reader.read();
    assert.equal(next.done, false, 'Customer service SSE ended early');
    buffer += decoder.decode(next.value, { stream: true });
    for (const line of buffer.split(/\r?\n/)) {
      if (line.startsWith('data: ') && match(JSON.parse(line.slice(6)) as Record<string, unknown>)) { await reader.cancel(); return; }
    }
  }
  assert.fail('Customer service SSE event not received');
}

async function customerServiceSmoke(api: string) {
  const client = `${api}/api/v1/client/customer-service`;
  const admin = `${api}/api/v1/admin/customer-service`;
  // 访客令牌只在 HttpOnly Cookie 中下发；冒烟脚本手动回传 Cookie，并带上读取 Cookie 所需的 X-CS-Visitor 头
  const issued = await fetch(`${client}/visitors`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
  assert.equal(issued.status, 201, 'Issue visitor token');
  cs.visitorId = ((await issued.json()) as Envelope<{ visitorId: string }>).data.visitorId;
  const visitorCookie = issued.headers.getSetCookie().find(value => value.startsWith('booth_cs_visitor='));
  assert.ok(visitorCookie && visitorCookie.includes('HttpOnly'), 'Visitor cookie is HttpOnly');
  const visitorHeaders = { cookie: visitorCookie.split(';')[0]!, 'x-cs-visitor': '1' };
  const scheme = (await database.query<{ code: string }>("SELECT code FROM schemes WHERE publish_status='published' ORDER BY code LIMIT 1")).rows[0];
  const opened = await call<{ conversation: { id: string } }>(`${client}/conversations`, { method: 'POST', headers: visitorHeaders,
    json: { entryPoint: scheme ? 'scheme_detail' : 'floating', ...(scheme ? { context: { kind: 'scheme', schemeCode: scheme.code } } : {}) } });
  assert.equal(opened.status, 201, 'Open conversation');
  cs.conversationId = opened.data.conversation.id;
  const posted = await call(`${client}/conversations/${cs.conversationId}/messages`, { method: 'POST', headers: visitorHeaders,
    json: { clientMessageId: randomUUID(), body: 'smoke question', kind: 'text' } });
  assert.equal(posted.status, 201, 'Customer message');

  // 临时坐席：本地角色授予 read + reply，直接写入会话（不经过外部 SSO）
  cs.roleId = -Math.floor(Math.random() * 1e9) - 1;
  await database.query('INSERT INTO admin_roles(id,name,permission_codes) VALUES($1,$2,$3)',
    [cs.roleId, `ROLE_SMOKE_CS_${probe}`, ['customer-service.read', 'customer-service.reply']]);
  cs.adminId = (await database.query<{ id: string }>('INSERT INTO admins(external_user_id,username,nickname,roles) VALUES($1,$2,$3,$4) RETURNING id',
    [cs.roleId, `smoke-cs-${probe}`, 'Smoke', [`ROLE_SMOKE_CS_${probe}`]])).rows[0]!.id;
  const token = await createSession(redis, { site: 'admin', localId: cs.adminId, externalUserId: cs.roleId, username: `smoke-cs-${probe}`,
    externalJwtCiphertext: encryptJwt('smoke', config.sessionSecret), loginSource: 'password', sessionVersion: 1 }, 300, Math.floor(Date.now() / 1000) + 300);
  const adminHeaders = { authorization: `Bearer ${token}` };
  assert.equal((await call(`${admin}/events-ticket`, { method: 'POST', headers: adminHeaders })).status, 200, 'Admin events ticket');
  assert.equal((await call(`${admin}/conversations/${cs.conversationId}/claim`, { method: 'POST', headers: adminHeaders })).status, 200, 'Claim');

  const ticket = await call<{ ticket: string }>(`${client}/conversations/${cs.conversationId}/events-ticket`, { method: 'POST', headers: visitorHeaders });
  const stream = await fetch(`${client}/conversations/${cs.conversationId}/events?ticket=${ticket.data.ticket}&after=0`, { signal: AbortSignal.timeout(20_000) });
  assert.equal(stream.status, 200, 'Customer SSE');
  const received = waitForEvent(stream, event => event.type === 'message.created'
    && (event.message as { senderType?: string; body?: string } | undefined)?.body === 'smoke reply');
  await delay(300);
  const reply = await call(`${admin}/conversations/${cs.conversationId}/messages`, { method: 'POST', headers: adminHeaders,
    json: { clientMessageId: randomUUID(), body: 'smoke reply', kind: 'text' } });
  assert.equal(reply.status, 201, 'Agent reply');
  await received;
  assert.equal((await call(`${admin}/conversations/${cs.conversationId}/close`, { method: 'POST', headers: adminHeaders })).status, 200, 'Close');
}

async function cleanupCustomerService() {
  if (cs.conversationId) {
    await database.query('DELETE FROM cs_message_translations WHERE message_id IN (SELECT id FROM cs_messages WHERE conversation_id=$1)', [cs.conversationId]);
    await database.query('DELETE FROM cs_messages WHERE conversation_id=$1', [cs.conversationId]);
    await database.query('DELETE FROM cs_conversation_contexts WHERE conversation_id=$1', [cs.conversationId]);
    await database.query('DELETE FROM cs_email_outbox WHERE conversation_id=$1', [cs.conversationId]);
    await database.query('DELETE FROM cs_conversations WHERE id=$1', [cs.conversationId]);
  }
  if (cs.visitorId) await database.query('DELETE FROM cs_visitors WHERE id=$1', [cs.visitorId]);
  if (cs.adminId) {
    await redis.zrem('cs:presence', cs.adminId);
    await database.query('DELETE FROM admins WHERE id=$1', [cs.adminId]);
  }
  if (cs.roleId !== null) await database.query('DELETE FROM admin_roles WHERE id=$1', [cs.roleId]);
}
