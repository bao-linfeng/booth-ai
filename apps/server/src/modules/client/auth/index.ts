import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { fetchExternalUserDetail, loginExternal, type ExternalUserDetail } from '../../../infra/external-auth.js';
import { createSession, destroySession, encryptJwt } from '../../../infra/session.js';

export interface CurrentUser {
  id: string;
  externalUserId: string;
  accountType: 'client' | 'admin';
  username: string;
  nickname: string | null;
  email: string | null;
  mobile: string | null;
  avatarPath: string | null;
  company: string | null;
  country: string | null;
  city: string | null;
  languageCode: string | null;
  enabled: boolean;
  roles: string[];
  permissions: string[];
  lastSyncedAt: string;
}

interface LocalIdRow {
  id: string;
}

function errorWithStatus(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function authorizationToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function jwtExpiresAt(jwt: string, fallbackTtlSeconds: number): number {
  const fallback = Math.floor(Date.now() / 1000) + fallbackTtlSeconds;
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return fallback;
    const parsed = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof parsed.exp === 'number' && Number.isSafeInteger(parsed.exp) && parsed.exp > Math.floor(Date.now() / 1000) ? parsed.exp : fallback;
  } catch {
    return fallback;
  }
}

export function toCurrentUser(localId: string, detail: ExternalUserDetail, accountType: 'client' | 'admin'): CurrentUser {
  return {
    id: localId,
    externalUserId: String(detail.externalUserId),
    accountType,
    username: detail.username,
    nickname: detail.nickname,
    email: detail.email,
    mobile: detail.mobile,
    avatarPath: detail.avatarPath,
    company: detail.company,
    country: detail.country,
    city: detail.city,
    languageCode: detail.languageCode,
    enabled: detail.enabled,
    roles: detail.roles,
    permissions: detail.permissions,
    lastSyncedAt: new Date().toISOString(),
  };
}

export async function syncClientUser(pool: pg.Pool, detail: ExternalUserDetail, updateLoginTime: boolean): Promise<string> {
  const result = await pool.query<LocalIdRow>(`
    INSERT INTO users (
      external_user_id, username, nickname, email, mobile, avatar_path, company, country, city, language_code,
      enabled, roles, permissions, last_login_at, last_synced_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $14 THEN now() ELSE NULL END, now(), now())
    ON CONFLICT (external_user_id) DO UPDATE SET
      username = EXCLUDED.username, nickname = EXCLUDED.nickname, email = EXCLUDED.email, mobile = EXCLUDED.mobile,
      avatar_path = EXCLUDED.avatar_path, company = EXCLUDED.company, country = EXCLUDED.country, city = EXCLUDED.city,
      language_code = EXCLUDED.language_code, enabled = EXCLUDED.enabled, roles = EXCLUDED.roles,
      permissions = EXCLUDED.permissions, last_login_at = CASE WHEN $14 THEN now() ELSE users.last_login_at END,
      last_synced_at = now(), updated_at = now()
    RETURNING id
  `, [
    detail.externalUserId, detail.username, detail.nickname, detail.email, detail.mobile, detail.avatarPath,
    detail.company, detail.country, detail.city, detail.languageCode, detail.enabled, detail.roles, detail.permissions, updateLoginTime,
  ]);
  const localId = result.rows[0]?.id;
  if (!localId) throw new Error('User synchronization did not return an ID');
  return localId;
}

export async function registerClientAuthRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  app.post('/auth/login', {
    schema: {
      tags: ['client-auth'],
      body: { type: 'object', required: ['username', 'password'], additionalProperties: false, properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } } },
    },
  }, async request => {
    const { username, password } = request.body as { username: string; password: string };
    const login = await loginExternal(config, 'client', username, password);
    const detail = await fetchExternalUserDetail(config, login.username, login.externalJwt);
    if (detail.externalUserId !== login.externalUserId) throw errorWithStatus('External user identity mismatch', 502);
    if (!detail.enabled) throw errorWithStatus('Account is disabled', 403);
    const localId = await syncClientUser(pool, detail, true);
    const expiresAt = jwtExpiresAt(login.externalJwt, config.sessionTtlSeconds);
    const accessToken = await createSession(redis, {
      site: 'client', localId, externalUserId: detail.externalUserId, username: detail.username,
      externalJwtCiphertext: encryptJwt(login.externalJwt, config.sessionSecret),
    }, config.sessionTtlSeconds, expiresAt);
    return { code: 0, message: 'ok', data: { accessToken, expiresAt, user: toCurrentUser(localId, detail, 'client') } };
  });

  app.post('/auth/logout', async request => {
    const token = authorizationToken(request.headers.authorization);
    if (token) await destroySession(redis, token);
    return { code: 0 };
  });
}
