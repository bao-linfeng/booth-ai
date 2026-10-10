import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { clientUserId } from '../../authentication.js';
import { getCreditBalance, signInForCredits } from '../../../modules/credits/account-service.js';

export async function registerClientCreditRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get('/credits/balance', { schema: { tags: ['client-credits'] } }, async request => {
    const userId = clientUserId(request);
    return { code: 0, data: { balance: await getCreditBalance(pool, userId) } };
  });

  app.post('/credits/sign-in', { schema: { tags: ['client-credits'] } }, async request => {
    const userId = clientUserId(request);
    return { code: 0, data: await signInForCredits(pool, userId) };
  });
}
