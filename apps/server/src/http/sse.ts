import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { waitForRedis } from '../infra/redis.js';

export interface EventStreamOptions {
  channels: string[];
  /** SUBSCRIBE 完成后执行，返回需要补发的事件（按顺序写出）；补发完成前收到的实时消息会暂存，之后按序写出 */
  replay?: () => Promise<unknown[]>;
  /** 每条 pub/sub 消息的过滤或改写；返回 null 表示丢弃 */
  filter?: (channel: string, payload: string) => string | null;
  /** 每次心跳（写出 ping 事件）时调用；返回 false 时关闭连接，抛错视为本次跳过 */
  onHeartbeat?: () => Promise<boolean | void>;
  /** 响应头写出后、补发前调用 */
  onOpen?: () => Promise<void>;
  heartbeatMs?: number;
}

interface Member {
  deliver: (channel: string, message: string) => void;
  unavailable: () => void;
}

interface Hub {
  subscriber: Redis;
  ready: Promise<void>;
  channels: Map<string, { members: Set<Member>; subscribed: Promise<unknown> }>;
  members: Set<Member>;
  closed: boolean;
}

// 进程级共享订阅器：同一 Redis 实例上的所有 SSE 共用一条订阅连接，频道按引用计数 SUBSCRIBE/UNSUBSCRIBE
const hubs = new WeakMap<Redis, Hub>();

function closeHub(redis: Redis, hub: Hub) {
  if (hub.closed) return;
  hub.closed = true;
  if (hubs.get(redis) === hub) hubs.delete(redis);
  for (const member of hub.members) member.unavailable();
  hub.members.clear();
  hub.channels.clear();
  hub.subscriber.disconnect();
}

function eventHub(redis: Redis): Hub {
  const existing = hubs.get(redis);
  if (existing) return existing;
  // 不自动重连：断开后关闭所有 SSE 由前端重连补发，下一条 SSE 重建订阅连接
  const subscriber = redis.duplicate({ retryStrategy: null });
  const hub: Hub = { subscriber, ready: waitForRedis(subscriber), channels: new Map(), members: new Set(), closed: false };
  hubs.set(redis, hub);
  const close = () => closeHub(redis, hub);
  hub.ready.catch(close);
  subscriber.on('error', close);
  subscriber.on('end', close);
  subscriber.on('message', (channel: string, message: string) => {
    for (const member of hub.channels.get(channel)?.members ?? []) member.deliver(channel, message);
  });
  return hub;
}

async function join(hub: Hub, member: Member, channels: Set<string>): Promise<void> {
  if (hub.closed) throw new Error('Redis subscriber closed');
  hub.members.add(member);
  const subscriptions = [...channels].map(channel => {
    let entry = hub.channels.get(channel);
    if (!entry) {
      entry = { members: new Set(), subscribed: hub.subscriber.subscribe(channel) };
      hub.channels.set(channel, entry);
    }
    entry.members.add(member);
    return entry.subscribed;
  });
  await Promise.all(subscriptions);
}

function leave(hub: Hub, member: Member, channels: Set<string>) {
  if (hub.closed || !hub.members.delete(member)) return;
  for (const channel of channels) {
    const entry = hub.channels.get(channel);
    if (!entry?.members.delete(member) || entry.members.size > 0) continue;
    hub.channels.delete(channel);
    hub.subscriber.unsubscribe(channel).catch(() => undefined);
  }
}

/** 进程退出时调用：断开共享订阅连接并关闭其上的所有 SSE */
export function closeEventStreams(redis: Redis): void {
  const hub = hubs.get(redis);
  if (hub) closeHub(redis, hub);
}

const write = (payload: string) => `event: update\ndata: ${payload}\n\n`;

/** 共用 SSE：先订阅再补发，避免两者之间的事件丢失；Redis 断开时关闭连接由前端重连补偿 */
export async function streamEvents(redis: Redis, reply: FastifyReply, options: EventStreamOptions): Promise<void> {
  const response = reply.raw;
  const channels = new Set(options.channels);
  const hub = eventHub(redis);
  let streaming = false;
  let closed = false;
  let pending: string[] | null = [];
  let heartbeat: NodeJS.Timeout | undefined;

  const member: Member = {
    deliver: (channel, message) => {
      if (closed) return;
      const payload = options.filter ? options.filter(channel, message) : message;
      if (payload === null) return;
      if (pending) pending.push(payload);
      else response.write(write(payload));
    },
    unavailable: () => {
      if (streaming) response.destroy();
    },
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    leave(hub, member, channels);
  };
  response.once('close', cleanup);

  try {
    await hub.ready;
    if (closed) return;
    await join(hub, member, channels);
    if (closed) return;
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) response.setHeader(name, value);
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    streaming = true;
    response.write(': connected\n\n');
    heartbeat = setInterval(() => {
      if (closed) return;
      // 用具名事件而不是注释：前端据此判断连接存活（代理吞掉上游断开时浏览器收不到 error）
      response.write('event: ping\ndata: {}\n\n');
      options.onHeartbeat?.().then(alive => { if (alive === false && !closed) response.end(); }, () => undefined);
    }, options.heartbeatMs ?? 15000);

    await options.onOpen?.();
    for (const event of await options.replay?.() ?? []) {
      if (closed) return;
      response.write(write(JSON.stringify(event)));
    }
    const buffered = pending;
    pending = null;
    if (!closed) for (const payload of buffered) response.write(write(payload));
  } catch (error) {
    cleanup();
    if (streaming) response.destroy();
    else throw error;
  }
}
