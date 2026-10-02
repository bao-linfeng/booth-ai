import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { getSession } from '../../../infra/session.js';

const visitorPattern = /^[a-zA-Z0-9_-]{16,128}$/;

export function getProvidedVisitorId(request: FastifyRequest): string | null {
  const header = request.headers['x-visitor-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && visitorPattern.test(value) ? value : null;
}

export function getVisitorId(request: FastifyRequest): string {
  return getProvidedVisitorId(request) ?? `v_${randomUUID().replaceAll('-', '')}`;
}

export async function getOptionalClientUserId(pool: pg.Pool, redis: Redis, request: FastifyRequest): Promise<string | null> {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
  if (!token) return null;
  const session = await getSession(redis, token, 'client');
  if (!session) return null;
  const user = (await pool.query<{ id: string }>('SELECT id FROM users WHERE id=$1 AND enabled=true', [session.localId])).rows[0];
  return user?.id ?? null;
}
