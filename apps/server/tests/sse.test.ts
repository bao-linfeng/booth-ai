import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import { streamEvents, type EventStreamOptions } from '../src/http/sse.js';

class Subscriber extends EventEmitter {
  status = 'connecting';
  channels: string[] = [];
  disconnected = false;
  async subscribe(...channels: string[]) { this.channels = channels; return channels.length; }
  disconnect() { this.disconnected = true; this.status = 'end'; this.emit('disconnected'); }
}

async function setup(options: Omit<EventStreamOptions, 'channels'>, channels = ['a', 'b']) {
  const subscriber = new Subscriber();
  const redis = { duplicate: () => { setImmediate(() => { subscriber.status = 'ready'; subscriber.emit('ready'); }); return subscriber; } } as unknown as Redis;
  const app = Fastify();
  app.get('/events', async (_request, reply) => streamEvents(redis, reply, { channels, ...options }));
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, subscriber, address };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string, text = '') {
  while (!text.includes(expected)) {
    const next = await reader.read();
    if (next.done) return { text, done: true };
    text += new TextDecoder().decode(next.value);
  }
  return { text, done: false };
}

test('shared SSE subscribes all channels, replays before buffered live events and filters messages', { timeout: 5000 }, async t => {
  let subscriber!: Subscriber;
  const { app, subscriber: sub, address } = await setup({
    replay: async () => {
      assert.deepEqual(subscriber.channels, ['a', 'b']);
      subscriber.emit('message', 'a', '{"live":1}');
      return [{ replay: 1 }, { replay: 2 }];
    },
    filter: (channel, payload) => (channel === 'b' && payload.includes('drop') ? null : payload),
  });
  subscriber = sub;
  const abort = new AbortController();
  t.after(async () => { abort.abort(); await app.close(); });
  const response = await fetch(`${address}/events`, { signal: abort.signal });
  const reader = response.body!.getReader();
  let { text } = await readUntil(reader, '"live":1');
  assert.ok(text.indexOf('"replay":1') < text.indexOf('"replay":2'));
  assert.ok(text.indexOf('"replay":2') < text.indexOf('"live":1'), 'live events are written after replay');
  subscriber.emit('message', 'b', '{"drop":true}');
  subscriber.emit('message', 'other', '{"foreign":true}');
  subscriber.emit('message', 'b', '{"keep":true}');
  ({ text } = await readUntil(reader, '"keep":true'));
  assert.doesNotMatch(text, /drop|foreign/);
});

test('shared SSE closes the stream when the heartbeat callback reports the subscriber is no longer valid', { timeout: 5000 }, async t => {
  let beats = 0;
  const { app, subscriber, address } = await setup({ heartbeatMs: 20, onHeartbeat: async () => { beats += 1; return beats < 2; } });
  t.after(() => app.close());
  const response = await fetch(`${address}/events`);
  const reader = response.body!.getReader();
  const disconnected = new Promise<void>(resolve => subscriber.once('disconnected', resolve));
  const { done } = await readUntil(reader, 'never-written');
  assert.equal(done, true);
  await disconnected;
  assert.equal(beats, 2);
});

test('shared SSE runs onOpen before replay and treats heartbeat callback errors as alive', { timeout: 5000 }, async t => {
  const calls: string[] = [];
  let beats = 0;
  const { app, address } = await setup({
    heartbeatMs: 20,
    onOpen: async () => { calls.push('open'); },
    replay: async () => { calls.push('replay'); return [{ ready: true }]; },
    onHeartbeat: async () => { beats += 1; throw new Error('transient'); },
  });
  const abort = new AbortController();
  t.after(async () => { abort.abort(); await app.close(); });
  const response = await fetch(`${address}/events`, { signal: abort.signal });
  const reader = response.body!.getReader();
  const { text } = await readUntil(reader, '"ready":true');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(calls, ['open', 'replay']);
  assert.ok(beats >= 2);
  // 心跳必须是浏览器可观察的具名事件（注释行不会触发任何监听），前端靠它发现被代理吞掉的断线
  assert.match((await readUntil(reader, 'event: ping\ndata: {}\n\n', text)).text, /event: ping\ndata: \{\}\n\n/);
});
