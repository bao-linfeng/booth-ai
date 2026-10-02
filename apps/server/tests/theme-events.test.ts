import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { streamThemeJobEvents } from '../src/http/client/theme-jobs/events.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const channel = `theme-job:${jobId}`;

class Subscriber extends EventEmitter {
  status = 'connecting';
  subscribed = false;
  disconnected = false;
  subscribeError = false;

  async subscribe(value: string) {
    assert.equal(this.status, 'ready', 'subscribe must wait for the new Redis connection');
    assert.equal(value, channel);
    if (this.subscribeError) throw new Error('Subscription failed');
    this.subscribed = true;
    return 1;
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
  const redis = {
    duplicate: () => {
      setImmediate(() => { subscriber.status = 'ready'; subscriber.emit('ready'); });
      return subscriber;
    },
  } as unknown as Redis;
  const pool = {
    query: async (_sql: string, params: unknown[]) => {
      assert.equal(subscriber.subscribed, true, 'subscribe before reading the snapshot');
      assert.deepEqual(params, [jobId, userId]);
      if (options.snapshotError) throw new Error('Snapshot unavailable');
      return { rows: [{ status: options.status ?? 'running', phase: null }] };
    },
  } as unknown as pg.Pool;
  const app = Fastify();
  await app.register(cors, { origin: ['http://localhost:5173'] });
  app.get('/events', async (_request, reply) => streamThemeJobEvents(pool, redis, jobId, userId, reply));
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, subscriber, address };
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
  const disconnected = once(subscriber, 'disconnected');
  abort.abort();
  await disconnected;
  assert.equal(subscriber.listenerCount('message'), 0);
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
  assert.equal(subscriber.disconnected, true);
});

test('snapshot failure closes an already opened SSE so the client can reconnect', { timeout: 5000 }, async t => {
  const { app, subscriber, address } = await setup({ snapshotError: true });
  t.after(() => app.close());
  await assert.rejects(async () => {
    const response = await fetch(`${address}/events`);
    await response.text();
  });
  assert.equal(subscriber.disconnected, true);
});
