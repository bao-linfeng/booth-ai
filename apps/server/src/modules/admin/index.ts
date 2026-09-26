import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../config.js';
import { registerAdminAuthRoutes } from './auth/index.js';
import { registerAdminMeRoutes } from './me/index.js';
import { registerAdminUserRoutes } from './users.controller.js';

export async function registerAdminModule(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  await app.register(async admin => {
    await registerAdminAuthRoutes(admin, config, pool, redis);
    await registerAdminMeRoutes(admin, config, pool, redis);
    await registerAdminUserRoutes(admin, pool);
  }, { prefix: '/api/v1/admin' });
}
