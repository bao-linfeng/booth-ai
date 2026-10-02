import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { destroySession } from '../../../infra/session.js';
import { loginAdmin } from '../../../modules/identity/admin-service.js';

function authorizationToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function registerAdminAuthRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  app.post('/auth/login', {
    schema: {
      tags: ['admin-auth'],
      body: { type: 'object', required: ['username', 'password'], additionalProperties: false, properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } } },
    },
  }, async request => {
    const { username, password } = request.body as { username: string; password: string };
    return { code: 0, message: 'ok', data: await loginAdmin(config, pool, redis, username, password) };
  });

  app.post('/auth/logout', async request => {
    const token = authorizationToken(request.headers.authorization);
    if (token) await destroySession(redis, token);
    return { code: 0 };
  });
}
