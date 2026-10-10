import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { fetchExternalUserDetail } from '../../../infra/external-auth.js';
import { decryptJwt, destroySession } from '../../../infra/session.js';
import { toCurrentUser } from '../../../modules/identity/service.js';
import { syncAdmin } from '../../../modules/identity/admin-service.js';
import { revokeAccountSessions } from '../../../modules/identity/principal.js';
import { requireAdminAccess } from '../../../modules/identity/roles.js';
import { accessSummary } from '../../../modules/identity/permissions.js';

import { requirePrincipal } from '../../authentication.js';
import { adminCurrentUserSchema, successResponse } from '../../schemas.js';

function authenticationError(): Error & { statusCode: number } {
  const error = new Error('Authentication required') as Error & { statusCode: number };
  error.statusCode = 401;
  return error;
}

export async function registerAdminMeRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get('/me', { schema: { tags: ['admin-auth'], response: { 200: successResponse(adminCurrentUserSchema) } } }, async request => {
    const { token, session, localId: accountId } = requirePrincipal(request, 'admin');
    let externalJwt: string;
    try {
      externalJwt = decryptJwt(session.externalJwtCiphertext, config.sessionSecret);
    } catch {
      await destroySession(redis, token);
      throw authenticationError();
    }
    try {
      const detail = await fetchExternalUserDetail(config, session.username, externalJwt);
      if (detail.externalUserId !== session.externalUserId) throw authenticationError();
      const permissions = await requireAdminAccess(pool, detail.roles);
      const { id: localId } = await syncAdmin(pool, detail, false);
      return { code: 0, message: 'ok', data: { ...toCurrentUser(localId, { ...detail, permissions }, 'admin', session.loginSource), homePath: accessSummary(permissions).homePath } };
    } catch (error) {
      const statusCode = (error as Partial<{ statusCode: number }>).statusCode;
      if (statusCode === 403 || statusCode === 401) {
        await revokeAccountSessions(pool, 'admin', accountId);
        await destroySession(redis, token);
        throw authenticationError();
      }
      throw error;
    }
  });
}
