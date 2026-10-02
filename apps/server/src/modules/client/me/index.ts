import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { fetchExternalUserDetail } from '../../../infra/external-auth.js';
import { decryptJwt, destroySession, getSession } from '../../../infra/session.js';
import { syncClientUser } from '../auth/service.js';
import { toCurrentUser } from '../../identity/service.js';

function authorizationToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function registerClientMeRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get('/me', { schema: { tags: ['client-auth'] } }, async request => {
    const token = authorizationToken(request.headers.authorization);
    const session = token ? await getSession(redis, token, 'client') : null;
    if (!token || !session) {
      const error = new Error('Authentication required') as Error & { statusCode: number };
      error.statusCode = 401;
      throw error;
    }
    let externalJwt: string;
    try {
      externalJwt = decryptJwt(session.externalJwtCiphertext, config.sessionSecret);
    } catch {
      await destroySession(redis, token);
      const error = new Error('Authentication required') as Error & { statusCode: number };
      error.statusCode = 401;
      throw error;
    }
    const detail = await fetchExternalUserDetail(config, session.username, externalJwt);
    if (detail.externalUserId !== session.externalUserId) {
      await destroySession(redis, token);
      const error = new Error('Authentication required') as Error & { statusCode: number };
      error.statusCode = 401;
      throw error;
    }
    const localId = await syncClientUser(pool, detail, false);
    return { code: 0, message: 'ok', data: toCurrentUser(localId, detail, 'client', session.loginSource) };
  });
}
