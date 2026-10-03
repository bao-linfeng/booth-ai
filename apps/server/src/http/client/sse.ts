import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { waitForRedis } from '../../infra/redis.js';

export async function streamJobEvents(
  redis: Redis,
  channel: string,
  reply: FastifyReply,
  fetchInitialState: () => Promise<unknown>,
): Promise<void> {
  const response = reply.raw;
  const subscriber = redis.duplicate({ retryStrategy: null });
  let streaming = false;
  let closed = false;
  let heartbeat: NodeJS.Timeout | undefined;

  const onMessage = (messageChannel: string, message: string) => {
    if (streaming && !closed && messageChannel === channel) response.write(`event: update\ndata: ${message}\n\n`);
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
    await subscriber.subscribe(channel);
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
      if (!closed) response.write(': heartbeat\n\n');
    }, 15000);

    const state = await fetchInitialState();
    if (!closed) response.write(`event: update\ndata: ${JSON.stringify(state)}\n\n`);
  } catch (error) {
    cleanup();
    if (streaming) response.destroy();
    else throw error;
  }
}
