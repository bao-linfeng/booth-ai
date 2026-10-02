import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from './logger.js';

export const QUEUE_NAME = 'booth-foundation';
export const TASK_NAME = 'system.echo';
export const THEME_QUEUE_NAME = 'booth-theme';
export const THEME_TASK_NAME = 'theme.generate';
export const ARTWORK_QUEUE_NAME = 'booth-artwork';
export const ARTWORK_TASK_NAME = 'artwork.generate';
export function createQueue(connection: Redis, name = QUEUE_NAME, backoffDelay = 1000) {
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: backoffDelay }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } },
  });
  queue.on('error', () => logger.error({ queue: name }, 'Queue connection error'));
  return queue;
}
