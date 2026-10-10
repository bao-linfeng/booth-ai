import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { contractApp } from '../helpers/http-app.js';
import cors from '@fastify/cors';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { createStorage } from '../../src/infra/storage.js';
import { registerArtworkJobRoutes } from '../../src/http/client/artwork-jobs/index.js';
import { registerAuthentication } from '../../src/http/authentication.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const otherJobId = '00000000-0000-4000-8000-000000000003';
const channel = `artwork-job:${jobId}`;

class Subscriber extends EventEmitter {
  status = 'connecting';
  subscribed = false;
  released = false;
  disconnected = false;
  subscribeError = false;

  async subscribe(value: string) {
    assert.equal(this.status, 'ready');
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
  const values = new Map<string, string>();
  values.set(
    `session:${createHash('sha256').update('owner').digest('hex').slice(0, 32)}`,
    JSON.stringify({ site: 'client', localId: userId, sessionVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
  );
  values.set(
    `session:${createHash('sha256').update('other').digest('hex').slice(0, 32)}`,
    JSON.stringify({ site: 'client', localId: otherJobId, sessionVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
  );
  const redis = {
    get: async (key: string) => values.get(key) ?? null,
    getdel: async (key: string) => {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    },
    set: async (key: string, value: string, mode: string, ttl: number) => {
      assert.equal(mode, 'EX');
      assert.equal(ttl, 300);
      values.set(key, value);
      return 'OK';
    },
    duplicate: () => {
      setImmediate(() => {
        subscriber.status = 'ready';
        subscriber.emit('ready');
      });
      return subscriber;
    },
  } as unknown as Redis;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM users')) return { rows: [{ enabled: true, roles: [], sessionVersion: 1 }] };
      if (sql.startsWith('SELECT status, phase')) {
        assert.equal(subscriber.subscribed, true, 'subscribe before reading the current state');
        assert.deepEqual(params, [jobId, userId]);
        if (options.snapshotError) throw new Error('Snapshot unavailable');
        return {
          rows: [
            { status: options.status ?? 'running', phase: null, deliveryStatus: options.status === 'succeeded' ? 'ready' : 'pending' },
          ],
        };
      }
      assert.ok(sql.includes('FROM artwork_jobs WHERE id=$1 AND user_id=$2'));
      return { rows: params[0] === jobId && params[1] === userId ? [{ id: jobId }] : [] };
    },
  } as unknown as pg.Pool;
  const app = contractApp();
  await app.register(cors, { origin: ['http://localhost:5173'] });
  registerAuthentication(app, pool, redis, 'client');
  await registerArtworkJobRoutes(app, pool, redis, {} as ReturnType<typeof createStorage>);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  async function ticket() {
    const response = await app.inject({
      method: 'POST',
      url: `/artwork-jobs/${jobId}/events-ticket`,
      headers: { authorization: 'Bearer owner' },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    return response.json<{ data: { ticket: string } }>().data.ticket;
  }
  return { app, subscriber, address, values, ticket };
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
test('artwork SSE closes at the next heartbeat after the owner logs out', { timeout: 5000 }, async t => {
  const { app, ticket, address, values } = await setup();
  t.mock.timers.enable({ apis: ['setInterval'] });
  const abort = new AbortController();
  t.after(async () => {
    abort.abort();
    await app.close();
  });
  const reader = (
    await fetch(`${address}/artwork-jobs/${jobId}/events?ticket=${await ticket()}`, { signal: abort.signal })
  ).body!.getReader();
  await readUntil(reader, '"running"');
  t.mock.timers.tick(15_000);
  await readUntil(reader, 'event: ping');
  values.delete(`session:${createHash('sha256').update('owner').digest('hex').slice(0, 32)}`);
  t.mock.timers.tick(15_000);
  for (let next = await reader.read(); !next.done; next = await reader.read());
});

test('artwork event tickets require ownership, reject invalid and mismatched tickets, and cannot be reused', { timeout: 5000 }, async t => {
  const { app, ticket, values } = await setup();
  t.after(() => app.close());
  const url = `/artwork-jobs/${jobId}/events-ticket`;
  assert.equal((await app.inject({ method: 'POST', url })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url, headers: { authorization: 'Bearer other' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/artwork-jobs/invalid/events-ticket' })).statusCode, 400);
  assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}/events?ticket=${randomUUID()}` })).statusCode, 401);
  const issued = await ticket();
  assert.deepEqual(JSON.parse(values.get(`artwork-events-ticket:${issued}`)!), { subject: jobId, userId, token: 'owner' });
  assert.equal((await app.inject({ url: `/artwork-jobs/${otherJobId}/events?ticket=${issued}` })).statusCode, 401);
  assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}/events?ticket=${issued}` })).statusCode, 401);
  assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}/events` })).statusCode, 400);
});

test('artwork SSE syncs completion missed before connecting, preserves CORS and cleans up on client close', { timeout: 5000 }, async t => {
  const { app, ticket, subscriber, address } = await setup({ status: 'succeeded' });
  const abort = new AbortController();
  t.after(async () => {
    abort.abort();
    await app.close();
  });
  const issued = await ticket();
  const response = await fetch(`${address}/artwork-jobs/${jobId}/events?ticket=${issued}`, {
    headers: { origin: 'http://localhost:5173' },
    signal: abort.signal,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const text = await readUntil(response.body!.getReader(), '"ready"');
  assert.match(text, /event: update\ndata: .*"succeeded"/);
  assert.equal((await app.inject({ url: `/artwork-jobs/${jobId}/events?ticket=${issued}` })).statusCode, 401);
  const released = once(subscriber, 'unsubscribed');
  abort.abort();
  await released;
  assert.equal(subscriber.subscribed, false);
  assert.equal(subscriber.disconnected, false, 'the shared subscriber connection outlives a single stream');
});

test('artwork SSE forwards direction and settlement changes and closes when Redis becomes unavailable', { timeout: 5000 }, async t => {
  const { app, ticket, subscriber, address } = await setup();
  const abort = new AbortController();
  t.after(async () => {
    abort.abort();
    await app.close();
  });
  const response = await fetch(`${address}/artwork-jobs/${jobId}/events?ticket=${await ticket()}`, { signal: abort.signal });
  const reader = response.body!.getReader();
  await readUntil(reader, '"running"');
  assert.equal(subscriber.disconnected, false);
  subscriber.emit('message', 'artwork-job:another-job', JSON.stringify({ status: 'failed' }));
  subscriber.emit('message', channel, JSON.stringify({ direction: 'front', status: 'succeeded' }));
  const direction = await readUntil(reader, '"front"');
  assert.match(direction, /event: update/);
  assert.ok(!direction.includes('"failed"'));
  subscriber.emit('message', channel, JSON.stringify({ status: 'partially_succeeded', deliveryStatus: 'incomplete' }));
  assert.match(await readUntil(reader, '"incomplete"'), /"partially_succeeded"/);
  const disconnected = new Promise<void>(resolve => subscriber.once('disconnected', resolve));
  subscriber.emit('error', new Error('Redis disconnected'));
  await assert.rejects(reader.read());
  await disconnected;
  assert.equal(subscriber.disconnected, true);
});

test('artwork SSE subscription failure returns HTTP error and snapshot failure closes the stream', { timeout: 5000 }, async t => {
  const failed = await setup({ subscribeError: true });
  t.after(() => failed.app.close());
  const response = await fetch(`${failed.address}/artwork-jobs/${jobId}/events?ticket=${await failed.ticket()}`);
  assert.equal(response.status, 500);
  assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(failed.subscriber.released, true);
  assert.equal(failed.subscriber.disconnected, false);
  const broken = await setup({ snapshotError: true });
  t.after(() => broken.app.close());
  await assert.rejects(async () => {
    const response = await fetch(`${broken.address}/artwork-jobs/${jobId}/events?ticket=${await broken.ticket()}`);
    await response.text();
  });
  assert.equal(broken.subscriber.released, true);
});
