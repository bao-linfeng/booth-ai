import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { destroySession } from '../../../infra/session.js';
import { getProvidedVisitorId } from '../selection/identity.js';
import { signInClient, signInClientWithToken } from '../../../modules/client-sign-in/service.js';
import { authorizationToken } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import { currentUserSchema, sessionSchema, successResponse } from '../../schemas.js';
import type { UserType } from '../../../modules/identity/service.js';

export async function registerClientAuthRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  app.post(
    '/auth/login',
    {
      config: { authentication: 'public' },
      onRequest: rateLimit(redis, 'login'),
      schema: {
        tags: ['client-auth'],
        response: { 200: successResponse(sessionSchema(currentUserSchema)) },
        body: {
          type: 'object',
          required: ['username', 'password'],
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: ['client'], default: 'client' },
          },
        },
      },
    },
    async request => {
      const { username, password } = request.body as { username: string; password: string };
      const data = await signInClient(config, pool, redis, username, password, getProvidedVisitorId(request));
      return { code: 0, message: 'ok', data };
    },
  );

  app.post(
    '/auth/sync',
    {
      config: { authentication: 'public' },
      onRequest: rateLimit(redis, 'login'),
      schema: {
        tags: ['client-auth'],
        summary: '使用外部 token 同步用户并建立客户端会话',
        response: { 200: successResponse(sessionSchema(currentUserSchema)) },
        body: {
          type: 'object',
          required: ['username', 'token'],
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1 },
            token: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: ['client', 'su'], default: 'client' },
          },
        },
      },
    },
    async request => {
      const { username, token, type } = request.body as { username: string; token: string; type: UserType };
      const data = await signInClientWithToken(config, pool, redis, username, token, getProvidedVisitorId(request), type);
      return { code: 0, message: 'ok', data };
    },
  );

  app.post('/auth/logout', { config: { authentication: 'public' } }, async request => {
    const token = authorizationToken(request.headers.authorization);
    if (token) await destroySession(redis, token);
    return { code: 0 };
  });
}
