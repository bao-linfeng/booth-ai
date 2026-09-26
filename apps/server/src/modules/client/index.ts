import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../config.js';
import { registerClientAuthRoutes } from './auth/index.js';
import { registerClientMeRoutes } from './me/index.js';

export async function registerClientModule(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  await app.register(async client => {
    await registerClientAuthRoutes(client, config, pool, redis);
    await registerClientMeRoutes(client, config, pool, redis);
  }, { prefix: '/api/v1/client' });
}
