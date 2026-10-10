import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import { closeEventStreams, streamEvents, type EventStreamOptions } from '../../src/http/sse.js';

class Subscriber extends EventEmitter {
  status = 'connecting';
  active = new Set<string>();
  commands: string[] = [];
  disconnected = false;
  async subscribe(channel: string) { this.commands.push(`+${channel}`); this.active.add(channel); return 1; }
  async unsubscribe(channel: string) { this.commands.push(`-${channel}`); this.active.delete(channel); this.emit('unsubscribed', channel); return 0; }
  disconnect() { this.disconnected = true; this.status = 'end'; this.emit('disconnected'); }
}

async function setup(options: Omit<EventStreamOptions, 'channels'> = {}) {
  const created: Subscriber[] = [];
  const redis = {
    duplicate: () => {
      const subscriber = new Subscriber();
      created.push(subscriber);
      setImmediate(() => { subscriber.status = 'ready'; subscriber.emit('ready'); });
      return subscriber;
    },
  } as unknown as Redis;
  const app = Fastify({ forceCloseConnections: true });
  app.get<{ Querystring: { channels?: string } }>('/events', async (request, reply) =>
    streamEvents(redis, reply, { channels: (request.query.channels ?? 'a,b').split(','), ...options }));
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, created, redis, address };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string, text = '') {
  while (!text.includes(expected)) {
    const next = await reader.read();
    if (next.done) return { text, done: true };
    text += new TextDecoder().decode(next.value);
  }
  return { text, done: false };
}

async function open(address: string, channels: string, t: test.TestContext) {
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await fetch(`${address}/events?channels=${channels}`, { signal: abort.signal });
  const reader = response.body!.getReader();
  await readUntil(reader, ': connected');
  return { abort, reader };
}

function waitUnsubscribed(subscriber: Subscriber, count: number) {
  const channels: string[] = [];
  return new Promise<string[]>(resolve => {
    const listener = (channel: string) => {
      channels.push(channel);
      if (channels.length < count) return;
      subscriber.off('unsubscribed', listener);
      resolve(channels.sort());
    };
    subscriber.on('unsubscribed', listener);
  });
}

test('shared SSE subscribes all channels, replays before buffered live events and filters messages', { timeout: 5000 }, async t => {
  const { app, address, created } = await setup({
    replay: async () => {
      assert.deepEqual([...created[0]!.active], ['a', 'b']);
      created[0]!.emit('message', 'a', '{"live":1}');
      return [{ replay: 1 }, { replay: 2 }];
    },
    filter: (channel, payload) => (channel === 'b' && payload.includes('drop') ? null : payload),
  });
  const abort = new AbortController();
  t.after(async () => { abort.abort(); await app.close(); });
  const response = await fetch(`${address}/events`, { signal: abort.signal });
  const reader = response.body!.getReader();
  let { text } = await readUntil(reader, '"live":1');
  assert.ok(text.indexOf('"replay":1') < text.indexOf('"replay":2'));
  assert.ok(text.indexOf('"replay":2') < text.indexOf('"live":1'), 'live events are written after replay');
  const subscriber = created[0]!;
  subscriber.emit('message', 'b', '{"drop":true}');
  subscriber.emit('message', 'other', '{"foreign":true}');
  subscriber.emit('message', 'b', '{"keep":true}');
  ({ text } = await readUntil(reader, '"keep":true'));
  assert.doesNotMatch(text, /drop|foreign/);
});

test('shared SSE streams reuse one Redis connection and reference-count channel subscriptions', { timeout: 5000 }, async t => {
  const { app, created, address } = await setup();
  t.after(() => app.close());
  const first = await open(address, 'a,b', t);
  const second = await open(address, 'b,c', t);
  assert.equal(created.length, 1, 'all streams share a single subscriber connection');
  const subscriber = created[0]!;
  assert.deepEqual(subscriber.commands, ['+a', '+b', '+c'], 'a shared channel is subscribed once');

  subscriber.emit('message', 'b', '{"shared":1}');
  subscriber.emit('message', 'c', '{"onlySecond":1}');
  assert.equal((await readUntil(first.reader, '"shared":1')).done, false);
  assert.match((await readUntil(second.reader, '"onlySecond":1')).text, /"shared":1/);

  let released = waitUnsubscribed(subscriber, 1);
  first.abort.abort();
  assert.deepEqual(await released, ['a'], 'only the channel nobody else listens to is released');
  assert.deepEqual([...subscriber.active], ['b', 'c']);

  released = waitUnsubscribed(subscriber, 2);
  second.abort.abort();
  assert.deepEqual(await released, ['b', 'c']);
  assert.equal(subscriber.disconnected, false, 'the process-level connection stays open for later streams');
  assert.equal(subscriber.listenerCount('message'), 1);
});

test('shared subscriber failure closes every stream and the next stream reconnects', { timeout: 5000 }, async t => {
  const { app, created, redis, address } = await setup();
  t.after(() => app.close());
  const first = await open(address, 'a', t);
  const second = await open(address, 'b', t);
  created[0]!.emit('error', new Error('Redis disconnected'));
  await assert.rejects(readUntil(first.reader, 'never-written'));
  await assert.rejects(readUntil(second.reader, 'never-written'));
  assert.equal(created[0]!.disconnected, true);

  const third = await open(address, 'a', t);
  assert.equal(created.length, 2);
  assert.deepEqual(created[1]!.commands, ['+a']);
  closeEventStreams(redis);
  await assert.rejects(readUntil(third.reader, 'never-written'));
  assert.equal(created[1]!.disconnected, true);
});

test('shared SSE closes the stream when the heartbeat callback reports the subscriber is no longer valid', { timeout: 5000 }, async t => {
  let beats = 0;
  const { app, created, address } = await setup({ heartbeatMs: 20, onHeartbeat: async () => { beats += 1; return beats < 2; } });
  t.after(() => app.close());
  const response = await fetch(`${address}/events?channels=a`);
  const reader = response.body!.getReader();
  const subscriber = created[0]!;
  const released = waitUnsubscribed(subscriber, 1);
  const { done } = await readUntil(reader, 'never-written');
  assert.equal(done, true);
  assert.deepEqual(await released, ['a']);
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

test('shared SSE writes heartbeat events as updates, buffered behind the replay', { timeout: 5000 }, async t => {
  let beats = 0;
  const { app, address } = await setup({
    heartbeatMs: 20,
    // 补发期间触发的心跳事件要排在补发之后，避免客户端先收到新状态再被补发覆盖
    replay: async () => { await new Promise(resolve => setTimeout(resolve, 60)); return [{ replay: 1 }]; },
    onHeartbeat: async send => { beats += 1; send({ type: 'presence', beat: beats }); },
  });
  const abort = new AbortController();
  t.after(async () => { abort.abort(); await app.close(); });
  const response = await fetch(`${address}/events`, { signal: abort.signal });
  const reader = response.body!.getReader();
  const { text } = await readUntil(reader, '"beat":3');
  assert.ok(text.indexOf('"replay":1') < text.indexOf('"beat":1'));
  assert.match(text, /event: update\ndata: \{"type":"presence","beat":1\}\n\n/);
});
