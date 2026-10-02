import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { getSession } from '../../infra/session.js';

export async function getAdminIdFromRequest(request: FastifyRequest, redis: Redis): Promise<string> {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
  const session = token ? await getSession(redis, token, 'admin') : null;
  if (!session) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  return session.localId;
}
