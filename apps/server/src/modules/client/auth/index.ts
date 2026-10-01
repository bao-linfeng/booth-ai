import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { destroySession } from '../../../infra/session.js';
import { getProvidedVisitorId } from '../../selection-analytics/service.js';
import { loginClient, syncClientSession } from './service.js';

export async function registerClientAuthRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  app.post('/auth/login', {
    schema: {
      tags: ['client-auth'],
      body: { type: 'object', required: ['username', 'password'], additionalProperties: false, properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } } },
    },
  }, async request => {
    const { username, password } = request.body as { username: string; password: string };
    const data = await loginClient(config, pool, redis, username, password, getProvidedVisitorId(request));
    return { code: 0, message: 'ok', data };
  });

  app.post('/auth/sync', {
    schema: {
      tags: ['client-auth'],
      summary: '使用外部 token 同步用户并建立客户端会话',
      body: { type: 'object', required: ['username', 'token'], additionalProperties: false, properties: { username: { type: 'string', minLength: 1 }, token: { type: 'string', minLength: 1 } } },
    },
  }, async request => {
    const { username, token } = request.body as { username: string; token: string };
    const data = await syncClientSession(config, pool, redis, username, token, getProvidedVisitorId(request));
    return { code: 0, message: 'ok', data };
  });

  app.post('/auth/logout', async request => {
    const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (token) await destroySession(redis, token);
    return { code: 0 };
  });
}
