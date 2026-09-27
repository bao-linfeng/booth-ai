import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../config.js';
import { createStorage } from '../../infra/storage.js';
import { getSession } from '../../infra/session.js';
import { registerAdminAuthRoutes } from './auth/index.js';
import { registerAdminMeRoutes } from './me/index.js';
import { registerAdminUserRoutes } from './users.controller.js';
import { registerAdminSchemesRoutes } from './schemes/index.js';
import { registerAdminSchemeImportsRoutes } from './scheme-imports/index.js';
import { registerAdminCatalogOptionsRoutes } from './catalog-options/index.js';
import { registerAdminAssetsRoutes } from './assets/index.js';
import { registerAdminBomRoutes } from './bill-of-materials/index.js';
import { registerAdminReviewsRoutes } from './reviews/index.js';
import { registerAdminDictionariesRoutes } from './dictionaries/index.js';

export async function registerAdminModule(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis, storage: ReturnType<typeof createStorage>): Promise<void> {
  await app.register(async admin => {
    admin.addHook('onRequest', async (request) => {
      const path = request.url.split('?')[0];
      if (path === '/api/v1/admin/auth/login' || path === '/api/v1/admin/auth/logout' || path === '/api/v1/admin/me') return;
      const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
      const session = token ? await getSession(redis, token, 'admin') : null;
      if (!session) throw Object.assign(new Error('Authentication required'), { statusCode: 401, reason: 'AUTH_REQUIRED' });
      const adminRow = (await pool.query<{ enabled: boolean; roles: string[] }>('SELECT enabled,roles FROM admins WHERE id=$1',[session.localId])).rows[0];
      if (!adminRow?.enabled || !adminRow.roles.includes('ROLE_ADMIN')) throw Object.assign(new Error('Administrator role required'), {statusCode:403,reason:'ACCESS_DENIED'});
    });
    await registerAdminAuthRoutes(admin, config, pool, redis);
    await registerAdminMeRoutes(admin, config, pool, redis);
    await registerAdminUserRoutes(admin, pool);
    await registerAdminSchemesRoutes(admin, pool);
    await registerAdminSchemeImportsRoutes(admin, pool);
    await registerAdminCatalogOptionsRoutes(admin, pool);
    await registerAdminAssetsRoutes(admin, pool, storage);
    await registerAdminBomRoutes(admin, pool, storage, redis, config);
    await registerAdminReviewsRoutes(admin, pool);
    await registerAdminDictionariesRoutes(admin, pool);
  }, { prefix: '/api/v1/admin' });
}
