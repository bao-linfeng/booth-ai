import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { checkAdminRole, fetchExternalUserDetail } from '../../../infra/external-auth.js';
import { decryptJwt, destroySession, getSession } from '../../../infra/session.js';
import { toCurrentUser } from '../../client/auth/service.js';
import { syncAdmin } from '../auth/index.js';

function authorizationToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function authenticationError(): Error & { statusCode: number } {
  const error = new Error('Authentication required') as Error & { statusCode: number };
  error.statusCode = 401;
  return error;
}

export async function registerAdminMeRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get('/me', { schema: { tags: ['admin-auth'] } }, async request => {
    const token = authorizationToken(request.headers.authorization);
    const session = token ? await getSession(redis, token, 'admin') : null;
    if (!token || !session) throw authenticationError();
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
      checkAdminRole(detail.roles);
      const localId = await syncAdmin(pool, detail, false);
      return { code: 0, message: 'ok', data: toCurrentUser(localId, detail, 'admin') };
    } catch (error) {
      const statusCode = (error as Partial<{ statusCode: number }>).statusCode;
      if (statusCode === 403 || statusCode === 401) {
        await destroySession(redis, token);
        throw authenticationError();
      }
      throw error;
    }
  });
}
