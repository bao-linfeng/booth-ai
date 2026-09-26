import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../config.js';
import { createStorage } from '../../infra/storage.js';
import { registerAdminAuthRoutes } from './auth/index.js';
import { registerAdminMeRoutes } from './me/index.js';
import { registerAdminUserRoutes } from './users.controller.js';
import { registerAdminSchemesRoutes } from './schemes/index.js';
import { registerAdminSchemeImportsRoutes } from './scheme-imports/index.js';
import { registerAdminCatalogOptionsRoutes } from './catalog-options/index.js';
import { registerAdminAssetsRoutes } from './assets/index.js';

export async function registerAdminModule(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis, storage: ReturnType<typeof createStorage>): Promise<void> {
  await app.register(async admin => {
    await registerAdminAuthRoutes(admin, config, pool, redis);
    await registerAdminMeRoutes(admin, config, pool, redis);
    await registerAdminUserRoutes(admin, pool);
    await registerAdminSchemesRoutes(admin, pool);
    await registerAdminSchemeImportsRoutes(admin, pool);
    await registerAdminCatalogOptionsRoutes(admin, pool);
    await registerAdminAssetsRoutes(admin, pool, storage);
  }, { prefix: '/api/v1/admin' });
}
