import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAdminProfile } from '../../../modules/identity/admin-service.js';
import { authenticationError } from '../../../modules/identity/principal.js';
import { accessSummary } from '../../../modules/identity/permissions.js';

import { requirePrincipal } from '../../authentication.js';
import { adminCurrentUserSchema, successResponse } from '../../schemas.js';

export async function registerAdminMeRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app
    .withTypeProvider<TypeProvider>()
    .get(
      '/me',
      { config: { permissions: [] }, schema: { tags: ['admin-auth'], response: { 200: successResponse(adminCurrentUserSchema) } } },
      async request => {
        // 资料以登录时同步到 admins 的为准，不再用灵通 JWT 回调灵通
        const { localId, permissions, session } = requirePrincipal(request, 'admin');
        const profile = await getAdminProfile(pool, localId, permissions, session.loginSource);
        if (!profile) throw authenticationError();
        return { code: 0 as const, message: 'ok', data: { ...profile, homePath: accessSummary(permissions).homePath } };
      },
    );
}
