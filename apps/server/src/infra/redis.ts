import { Redis } from 'ioredis';
import type { Config } from '../config.js';

export function createRedis(config: Config, role: 'request' | 'worker' = 'request') {
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: role === 'worker' ? null : 1,
    connectTimeout: 5000,
    enableOfflineQueue: role === 'worker',
    ...(role === 'request' ? { commandTimeout: 5000 } : {}),
    retryStrategy: times => Math.min(times * 250, 5000),
  });
  redis.on('error', () => console.error(`Redis ${role} connection error`));
  return redis;
}

export async function waitForRedis(redis: Redis): Promise<void> {
  if (redis.status === 'ready') return;
  await new Promise<void>((resolve, reject) => {
    const clean = () => { clearTimeout(timer); redis.off('ready', ready); redis.off('error', failed); };
    const ready = () => { clean(); resolve(); };
    const failed = () => { clean(); reject(new Error('Redis connection failed')); };
    const timer = setTimeout(() => { clean(); reject(new Error('Redis connection timed out')); }, 10000);
    redis.once('ready', ready);
    redis.once('error', failed);
  });
}
