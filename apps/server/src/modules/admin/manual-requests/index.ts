import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { getAdminIdFromRequest } from '../session.js';
import { followUpManualRequest, getManualRequest, listManualRequests } from './service.js';

const params = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };

export async function registerAdminManualRequestRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get('/manual-requests', { schema: { tags: ['admin-manual-requests'], querystring: { type: 'object', additionalProperties: false, properties: {
    page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 }, status: { type: 'string', enum: ['pending', 'following_up', 'completed'] },
  } } } }, async request => ({ code: 0, data: await listManualRequests(pool, request.query as { page?: number; pageSize?: number; status?: string }) }));
  app.get('/manual-requests/:id', { schema: { tags: ['admin-manual-requests'], params } }, async request => ({ code: 0, data: await getManualRequest(pool, (request.params as { id: string }).id) }));
  app.patch('/manual-requests/:id', { schema: { tags: ['admin-manual-requests'], params, body: { type: 'object', additionalProperties: false,
    required: ['status', 'followUpNote'], properties: { status: { type: 'string', enum: ['pending', 'following_up', 'completed'] }, followUpNote: { type: 'string', maxLength: 2000 } },
  } } }, async request => ({ code: 0, data: await followUpManualRequest(pool, (request.params as { id: string }).id, await getAdminIdFromRequest(request, redis), request.body as { status: 'pending' | 'following_up' | 'completed'; followUpNote: string }) }));
}
