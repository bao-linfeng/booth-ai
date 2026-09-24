import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const QUEUE_NAME = 'booth-foundation';
export const TASK_NAME = 'system.echo';
export function createQueue(connection: Redis) {
  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } },
  });
  queue.on('error', () => console.error('Queue connection error'));
  return queue;
}
