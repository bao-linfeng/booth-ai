import type { JsonSchemaToTsProvider } from '@fastify/type-provider-json-schema-to-ts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { clientUserId } from '../../authentication.js';
import { successResponse } from '../../schemas.js';
import { getCreditBalance, signInForCredits } from '../../../modules/credits/account-service.js';

const balanceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['balance'],
  properties: { balance: { type: 'integer' } },
} as const;
const signInSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'balance'],
  properties: { amount: { type: 'integer', description: '本次签到获得的积分' }, balance: { type: 'integer' } },
} as const;

export async function registerClientCreditRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<JsonSchemaToTsProvider>();
  routes.get(
    '/credits/balance',
    { schema: { tags: ['client-credits'], response: { 200: successResponse(balanceSchema) } } },
    async request => {
      const userId = clientUserId(request);
      return { code: 0, data: { balance: await getCreditBalance(pool, userId) } } as const;
    },
  );

  routes.post(
    '/credits/sign-in',
    { schema: { tags: ['client-credits'], response: { 200: successResponse(signInSchema) } } },
    async request => {
      const userId = clientUserId(request);
      return { code: 0, data: await signInForCredits(pool, userId) } as const;
    },
  );
}
