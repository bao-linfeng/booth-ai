import type { FastifyInstance } from 'fastify';
import type { TypeProvider } from '../../type-provider.js';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import { getUserCreditBalance, listCreditTransactions, rechargeCredits } from '../../../modules/credits/management-service.js';
import { pageSchema, successResponse } from '../../schemas.js';
import { getSignInConfig, updateSignInConfig } from '../../../modules/credits/account-service.js';

const userIdSchema = { type: 'string', format: 'uuid' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const transactionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'userId',
    'username',
    'nickname',
    'kind',
    'amount',
    'note',
    'operatorId',
    'operatorName',
    'jobType',
    'jobId',
    'createdAt',
  ],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    username: nullableString,
    nickname: nullableString,
    kind: { type: 'string', enum: ['sign_in', 'recharge', 'theme_consume', 'artwork_consume'] },
    amount: { type: 'integer', description: '正数为入账，负数为消费' },
    note: nullableString,
    operatorId: nullableString,
    operatorName: nullableString,
    jobType: { type: ['string', 'null'], enum: ['theme', 'artwork', null] },
    jobId: nullableString,
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;
const signInConfigSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['enabled', 'dailyAmount', 'timezone'],
  properties: { enabled: { type: 'boolean' }, dailyAmount: { type: 'integer' }, timezone: { type: 'string' } },
} as const;

export async function registerAdminCreditRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/credits',
    {
      config: { permissions: ['credits.read'] },
      schema: {
        tags: ['admin-credits'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
            userId: userIdSchema,
            kind: { type: 'string', enum: ['sign_in', 'recharge', 'theme_consume', 'artwork_consume'] },
            jobId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 200: successResponse(pageSchema(transactionSchema)) },
      },
    },
    async request =>
      ({
        code: 0,
        data: await listCreditTransactions(pool, {
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20,
          ...(request.query.userId ? { userId: request.query.userId } : {}),
          ...(request.query.kind ? { kind: request.query.kind } : {}),
          ...(request.query.jobId ? { jobId: request.query.jobId } : {}),
        }),
      }) as const,
  );

  routes.post(
    '/credits/recharge',
    {
      config: { permissions: ['credits.recharge'] },
      schema: {
        tags: ['admin-credits'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['userId', 'amount', 'requestKey'],
          properties: {
            requestKey: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
            userId: userIdSchema,
            amount: { type: 'integer', minimum: 1, maximum: 2147483647 },
            note: { type: 'string' },
          },
        },
        response: { 200: successResponse(transactionSchema) },
      },
    },
    async request => {
      const operatorId = adminUserId(request);
      return { code: 0, data: await rechargeCredits(pool, { ...request.body, operatorId }) } as const;
    },
  );

  routes.get(
    '/credits/users/:userId/balance',
    {
      config: { permissions: ['credits.read'] },
      schema: {
        tags: ['admin-credits'],
        params: { type: 'object', required: ['userId'], properties: { userId: userIdSchema } },
        response: {
          200: successResponse({
            type: 'object',
            additionalProperties: false,
            required: ['balance'],
            properties: { balance: { type: 'integer' } },
          }),
        },
      },
    },
    async request => ({ code: 0, data: { balance: await getUserCreditBalance(pool, request.params.userId) } }) as const,
  );

  // 签到配置
  routes.get(
    '/credits/sign-in-config',
    {
      config: { permissions: ['credits.read'] },
      schema: { tags: ['admin-credits'], response: { 200: successResponse(signInConfigSchema) } },
    },
    async () => ({ code: 0, data: await getSignInConfig(pool) }) as const,
  );

  routes.put(
    '/credits/sign-in-config',
    {
      config: { permissions: ['credits.sign_in_config'] },
      schema: {
        tags: ['admin-credits'],
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'dailyAmount', 'timezone'],
          properties: {
            enabled: { type: 'boolean' },
            dailyAmount: { type: 'integer', minimum: 1, maximum: 10000 },
            timezone: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
        response: { 200: successResponse(signInConfigSchema) },
      },
    },
    async request => ({ code: 0, data: await updateSignInConfig(pool, request.body, adminUserId(request)) }) as const,
  );
}
