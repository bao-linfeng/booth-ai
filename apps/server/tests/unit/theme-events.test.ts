import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { streamThemeJobEvents } from '../../src/http/client/theme-jobs/events.js';
import type { Principal } from '../../src/modules/identity/principal.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const channel = `theme-job:${jobId}`;
const sessionKey = `session:${createHash('sha256').update('owner').digest('hex').slice(0, 32)}`;
const session = { site: 'client' as const, localId: userId, externalUserId: 1, username: 'owner', externalJwtCiphertext: '', expiresAt: Math.floor(Date.now() / 1000) + 3600,
  loginSource: 'password' as const, sessionVersion: 1 };
const principal: Principal = { site: 'client', localId: userId, roles: [], permissions: [], session, token: 'owner' };

class Subscriber extends EventEmitter {
  status = 'connecting';
  subscribed = false;
  released = false;
  disconnected = false;
  subscribeError = false;

  async subscribe(value: string) {
    assert.equal(this.status, 'ready', 'subscribe must wait for the new Redis connection');
    assert.equal(value, channel);
    if (this.subscribeError) throw new Error('Subscription failed');
    this.subscribed = true;
    return 1;
  }

  async unsubscribe(value: string) {
    assert.equal(value, channel);
    this.subscribed = false;
    this.released = true;
    this.emit('unsubscribed');
    return 0;
  }

  disconnect() {
    this.disconnected = true;
    this.status = 'end';
    this.emit('disconnected');
  }
}

async function setup(options: { status?: string; subscribeError?: boolean; snapshotError?: boolean } = {}) {
  const subscriber = new Subscriber();
  subscriber.subscribeError = options.subscribeError ?? false;
  const values = new Map([[sessionKey, JSON.stringify(session)]]);
  const redis = {
    get: async (key: string) => values.get(key) ?? null,
    duplicate: () => {
      setImmediate(() => { subscriber.status = 'ready'; subscriber.emit('ready'); });
      return subscriber;
    },
  } as unknown as Redis;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM users')) return { rows: [{ enabled: true, roles: [], sessionVersion: 1 }] };
      assert.equal(subscriber.subscribed, true, 'subscribe before reading the snapshot');
      assert.deepEqual(params, [jobId, userId]);
      if (options.snapshotError) throw new Error('Snapshot unavailable');
      return { rows: [{ status: options.status ?? 'running', phase: null }] };
    },
  } as unknown as pg.Pool;
  const app = Fastify();
  await app.register(cors, { origin: ['http://localhost:5173'] });
  app.get('/events', async (_request, reply) => streamThemeJobEvents(pool, redis, jobId, principal, reply));
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, subscriber, address, values };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string) {
  let text = '';
  while (!text.includes(expected)) {
    const next = await reader.read();
    assert.equal(next.done, false, `Stream ended before ${expected}`);
    text += new TextDecoder().decode(next.value);
  }
  return text;
}

// 放在第一个：启用 mock 时不能有前面用例尚未触发的 close 回调，否则它们会调用被替换的 clearInterval，漏清真实心跳定时器
test('SSE rechecks the login session on every heartbeat and closes once it is gone', { timeout: 5000 }, async t => {
  const { app, address, values } = await setup();
  t.mock.timers.enable({ apis: ['setInterval'] });
  const abort = new AbortController();
  t.after(async () => { abort.abort(); await app.close(); });
  const reader = (await fetch(`${address}/events`, { signal: abort.signal })).body!.getReader();
  await readUntil(reader, '"running"');
  t.mock.timers.tick(15_000);
  await readUntil(reader, 'event: ping');
  values.delete(sessionKey);
  t.mock.timers.tick(15_000);
  for (let next = await reader.read(); !next.done; next = await reader.read());
});

test('SSE waits for Redis readiness, snapshots missed completion, and preserves CORS', { timeout: 5000 }, async t => {
  const { app, subscriber, address } = await setup({ status: 'succeeded' });
  const abort = new AbortController();
  t.after(async () => { abort.abort(); await app.close(); });
  const response = await fetch(`${address}/events`, { headers: { origin: 'http://localhost:5173' }, signal: abort.signal });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const reader = response.body!.getReader();
  assert.match(await readUntil(reader, '"succeeded"'), /event: update\ndata: /);
  const released = once(subscriber, 'unsubscribed');
  abort.abort();
  await released;
  assert.equal(subscriber.subscribed, false);
  assert.equal(subscriber.disconnected, false, 'the shared subscriber connection outlives a single stream');
});

test('SSE keeps the subscription after the GET request and forwards later completion', { timeout: 5000 }, async t => {
  const { app, subscriber, address } = await setup();
  const abort = new AbortController();
  t.after(async () => { abort.abort(); await app.close(); });
  const response = await fetch(`${address}/events`, { signal: abort.signal });
  const reader = response.body!.getReader();
  await readUntil(reader, '"running"');
  assert.equal(subscriber.disconnected, false);
  subscriber.emit('message', channel, JSON.stringify({ status: 'succeeded' }));
  assert.match(await readUntil(reader, '"succeeded"'), /event: update/);
  const disconnected = new Promise<void>(resolve => subscriber.once('disconnected', resolve));
  subscriber.emit('error', new Error('Redis disconnected'));
  await assert.rejects(reader.read());
  await disconnected;
  assert.equal(subscriber.disconnected, true);
});

test('subscription failure returns an HTTP error instead of a dead successful SSE', { timeout: 5000 }, async t => {
  const { app, subscriber, address } = await setup({ subscribeError: true });
  t.after(() => app.close());
  const response = await fetch(`${address}/events`);
  assert.equal(response.status, 500);
  assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(subscriber.released, true);
  assert.equal(subscriber.disconnected, false);
});

test('snapshot failure closes an already opened SSE so the client can reconnect', { timeout: 5000 }, async t => {
  const { app, subscriber, address } = await setup({ snapshotError: true });
  t.after(() => app.close());
  await assert.rejects(async () => {
    const response = await fetch(`${address}/events`);
    await response.text();
  });
  assert.equal(subscriber.released, true);
});
