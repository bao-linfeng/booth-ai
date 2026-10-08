import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { fetchExternalUserDetail } from '../../../infra/external-auth.js';
import { decryptJwt, destroySession } from '../../../infra/session.js';
import { syncClientUser } from '../../../modules/identity/client-service.js';
import { toCurrentUser } from '../../../modules/identity/service.js';
import { revokeAccountSessions } from '../../../modules/identity/principal.js';
import { requirePrincipal } from '../../authentication.js';

export async function registerClientMeRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get('/me', { schema: { tags: ['client-auth'] } }, async request => {
    const { token, session, localId: accountId } = requirePrincipal(request, 'client');
    let externalJwt: string;
    try {
      externalJwt = decryptJwt(session.externalJwtCiphertext, config.sessionSecret);
    } catch {
      await destroySession(redis, token);
      const error = new Error('Authentication required') as Error & { statusCode: number };
      error.statusCode = 401;
      throw error;
    }
    try {
      const detail = await fetchExternalUserDetail(config, session.username, externalJwt);
      if (detail.externalUserId !== session.externalUserId) {
        throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
      }
      const { id: localId, type } = await syncClientUser(pool, detail, false);
      return { code: 0, message: 'ok', data: toCurrentUser(localId, detail, 'client', session.loginSource, type) };
    } catch (error) {
      if ([401, 403].includes((error as { statusCode: number }).statusCode)) {
        await revokeAccountSessions(pool, 'client', accountId);
        await destroySession(redis, token);
      }
      throw error;
    }
  });
}
