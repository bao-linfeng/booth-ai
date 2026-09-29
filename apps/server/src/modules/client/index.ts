import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../config.js';
import { registerClientAuthRoutes } from './auth/index.js';
import { registerClientMeRoutes } from './me/index.js';
import type { createStorage } from '../../infra/storage.js';
import { registerSelectionRoutes } from './selection/index.js';
import { registerClientBomRoutes } from './bill-of-materials/index.js';
import { registerThemeModelRoutes } from './theme-jobs/index.js';
import { registerClientSchemeAssetRoutes } from './schemes/index.js';
import { registerClientManualRequestRoutes } from './manual-requests/index.js';

export async function registerClientModule(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis, storage: ReturnType<typeof createStorage>): Promise<void> {
  await app.register(async client => {
    await registerClientAuthRoutes(client, config, pool, redis);
    await registerClientMeRoutes(client, config, pool, redis);
    await registerSelectionRoutes(client, pool, redis, storage, config);
    await registerClientManualRequestRoutes(client, pool, redis);
    await registerClientBomRoutes(client, pool);
    await registerClientSchemeAssetRoutes(client, pool, storage);
    await registerThemeModelRoutes(client, pool);
  }, { prefix: '/api/v1/client' });
}
