import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { destroySession } from '../../../infra/session.js';
import { loginAdmin } from '../../../modules/identity/admin-service.js';
import { authorizationToken } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import { currentUserSchema, okResponse, sessionSchema, successResponse } from '../../schemas.js';

export async function registerAdminAuthRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.post(
    '/auth/login',
    {
      config: { authentication: 'public' },
      onRequest: rateLimit(redis, 'login'),
      schema: {
        tags: ['admin-auth'],
        response: { 200: successResponse(sessionSchema(currentUserSchema)) },
        body: {
          type: 'object',
          required: ['username', 'password'],
          additionalProperties: false,
          properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } },
        },
      },
    },
    async request => {
      const { username, password } = request.body;
      return { code: 0, message: 'ok', data: await loginAdmin(config, pool, redis, username, password) } as const;
    },
  );

  routes.post('/auth/logout', { config: { authentication: 'public' }, schema: { response: { 200: okResponse } } }, async request => {
    const token = authorizationToken(request.headers.authorization);
    if (token) await destroySession(redis, token);
    return { code: 0 } as const;
  });
}
