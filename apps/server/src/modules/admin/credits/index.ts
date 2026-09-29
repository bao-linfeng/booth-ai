import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { getAdminIdFromRequest } from '../session.js';
import { getUserCreditBalance, listCreditTransactions, rechargeCredits, type CreditKind } from './service.js';

interface CreditListQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  kind?: CreditKind;
}

interface RechargeBody {
  userId: string;
  amount: number;
  note?: string;
}

const userIdSchema = { type: 'string', format: 'uuid' };

export async function registerAdminCreditRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get<{ Querystring: CreditListQuery }>('/credits', { schema: {
    tags: ['admin-credits'],
    querystring: { type: 'object', additionalProperties: false, properties: {
      page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      userId: userIdSchema, kind: { type: 'string', enum: ['sign_in', 'recharge', 'theme_consume'] },
    } },
  } }, async request => ({ code: 0, data: await listCreditTransactions(pool, {
    page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 20,
    ...(request.query.userId ? { userId: request.query.userId } : {}),
    ...(request.query.kind ? { kind: request.query.kind } : {}),
  }) }));

  app.post<{ Body: RechargeBody }>('/credits/recharge', { schema: {
    tags: ['admin-credits'], body: { type: 'object', additionalProperties: false, required: ['userId', 'amount'], properties: {
      userId: userIdSchema, amount: { type: 'integer', minimum: 1, maximum: 2147483647 },
      note: { type: 'string' },
    } },
  } }, async request => {
    const operatorId = await getAdminIdFromRequest(request, redis);
    return { code: 0, data: await rechargeCredits(pool, { ...request.body, operatorId }) };
  });

  app.get<{ Params: { userId: string } }>('/credits/users/:userId/balance', { schema: {
    tags: ['admin-credits'], params: { type: 'object', required: ['userId'], properties: { userId: userIdSchema } },
  } }, async request => ({ code: 0, data: { balance: await getUserCreditBalance(pool, request.params.userId) } }));
}
