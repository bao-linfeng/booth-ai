import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { getSession } from '../../../infra/session.js';
import { getCreditBalance, signInForCredits } from './service.js';

async function clientId(authorization: string | undefined, redis: Redis): Promise<string> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim();
  const session = token ? await getSession(redis, token, 'client') : null;
  if (!session) throw Object.assign(new Error('Authentication required'), { statusCode: 401, reason: 'AUTH_REQUIRED' });
  return session.localId;
}

export async function registerClientCreditRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get('/credits/balance', { schema: { tags: ['client-credits'] } }, async request => {
    const userId = await clientId(request.headers.authorization, redis);
    return { code: 0, data: { balance: await getCreditBalance(pool, userId) } };
  });

  app.post('/credits/sign-in', { schema: { tags: ['client-credits'] } }, async request => {
    const userId = await clientId(request.headers.authorization, redis);
    return { code: 0, data: await signInForCredits(pool, userId) };
  });
}
