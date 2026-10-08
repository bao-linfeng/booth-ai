import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { waitForRedis } from '../infra/redis.js';

export interface EventStreamOptions {
  channels: string[];
  /** SUBSCRIBE 完成后执行，返回需要补发的事件（按顺序写出）；补发完成前收到的实时消息会暂存，之后按序写出 */
  replay?: () => Promise<unknown[]>;
  /** 每条 pub/sub 消息的过滤或改写；返回 null 表示丢弃 */
  filter?: (channel: string, payload: string) => string | null;
  /** 每次心跳时调用；返回 false 时关闭连接，抛错视为本次跳过 */
  onHeartbeat?: () => Promise<boolean | void>;
  /** 响应头写出后、补发前调用 */
  onOpen?: () => Promise<void>;
  heartbeatMs?: number;
}

const write = (payload: string) => `event: update\ndata: ${payload}\n\n`;

/** 共用 SSE：先订阅再补发，避免两者之间的事件丢失；Redis 断开时关闭连接由前端重连补偿 */
export async function streamEvents(redis: Redis, reply: FastifyReply, options: EventStreamOptions): Promise<void> {
  const response = reply.raw;
  const channels = new Set(options.channels);
  const subscriber = redis.duplicate({ retryStrategy: null });
  let streaming = false;
  let closed = false;
  let pending: string[] | null = [];
  let heartbeat: NodeJS.Timeout | undefined;

  const onMessage = (channel: string, message: string) => {
    if (closed || !channels.has(channel)) return;
    const payload = options.filter ? options.filter(channel, message) : message;
    if (payload === null) return;
    if (pending) pending.push(payload);
    else response.write(write(payload));
  };
  const onUnavailable = () => {
    if (streaming) response.destroy();
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    subscriber.off('message', onMessage);
    subscriber.off('error', onUnavailable);
    subscriber.off('end', onUnavailable);
    subscriber.disconnect();
  };
  response.once('close', cleanup);
  subscriber.on('message', onMessage);
  subscriber.on('error', onUnavailable);
  subscriber.on('end', onUnavailable);

  try {
    await waitForRedis(subscriber);
    await subscriber.subscribe(...channels);
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
      response.write(': heartbeat\n\n');
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
