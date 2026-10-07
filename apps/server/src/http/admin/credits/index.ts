import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import { getUserCreditBalance, listCreditTransactions, rechargeCredits, type CreditKind } from '../../../modules/credits/management-service.js';
import { getSignInConfig } from '../../../modules/credits/account-service.js';

interface CreditListQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  kind?: CreditKind;
  jobId?: string;
}

interface RechargeBody {
  requestKey: string;
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
      userId: userIdSchema, kind: { type: 'string', enum: ['sign_in', 'recharge', 'theme_consume', 'artwork_consume'] },
      jobId: { type: 'string', format: 'uuid' },
    } },
  } }, async request => ({ code: 0, data: await listCreditTransactions(pool, {
    page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 20,
    ...(request.query.userId ? { userId: request.query.userId } : {}),
    ...(request.query.kind ? { kind: request.query.kind } : {}),
    ...(request.query.jobId ? { jobId: request.query.jobId } : {}),
  }) }));

  app.post<{ Body: RechargeBody }>('/credits/recharge', { schema: {
    tags: ['admin-credits'], body: { type: 'object', additionalProperties: false, required: ['userId', 'amount', 'requestKey'], properties: {
      requestKey: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
      userId: userIdSchema, amount: { type: 'integer', minimum: 1, maximum: 2147483647 },
      note: { type: 'string' },
    } },
  } }, async request => {
    const operatorId = adminUserId(request);
    return { code: 0, data: await rechargeCredits(pool, { ...request.body, operatorId }) };
  });

  app.get<{ Params: { userId: string } }>('/credits/users/:userId/balance', { schema: {
    tags: ['admin-credits'], params: { type: 'object', required: ['userId'], properties: { userId: userIdSchema } },
  } }, async request => ({ code: 0, data: { balance: await getUserCreditBalance(pool, request.params.userId) } }));

  // 签到配置
  app.get('/credits/sign-in-config', { schema: { tags: ['admin-credits'] } }, async () => {
    return { code: 0, data: await getSignInConfig(pool) };
  });

  app.put<{ Body: { enabled: boolean; dailyAmount: number; timezone: string } }>('/credits/sign-in-config', { schema: {
    tags: ['admin-credits'],
    body: { type: 'object', additionalProperties: false, required: ['enabled', 'dailyAmount', 'timezone'], properties: {
      enabled: { type: 'boolean' },
      dailyAmount: { type: 'integer', minimum: 1, maximum: 10000 },
      timezone: { type: 'string', minLength: 1, maxLength: 100 },
    } },
  } }, async request => {
    const { enabled, dailyAmount, timezone } = request.body;
    await pool.query(
      `INSERT INTO sign_in_config (id, enabled, daily_amount, timezone)
       VALUES (TRUE, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET enabled=$1, daily_amount=$2, timezone=$3`,
      [enabled, dailyAmount, timezone],
    );
    return { code: 0, data: { enabled, dailyAmount, timezone } };
  });
}
