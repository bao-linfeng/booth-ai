import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { checkAdminRole, fetchExternalUserDetail, loginExternal, type ExternalUserDetail } from '../../../infra/external-auth.js';
import { createSession, destroySession, encryptJwt } from '../../../infra/session.js';
import { jwtExpiresAt, toCurrentUser, type CurrentUser } from '../../client/auth/service.js';

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

export async function syncAdmin(pool: pg.Pool, detail: ExternalUserDetail, updateLoginTime: boolean): Promise<string> {
  const result = await pool.query<LocalIdRow>(`
    INSERT INTO admins (
      external_user_id, username, nickname, email, mobile, avatar_path, company, country, city, language_code,
      enabled, roles, permissions, last_login_at, last_synced_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $14 THEN now() ELSE NULL END, now(), now())
    ON CONFLICT (external_user_id) DO UPDATE SET
      username = EXCLUDED.username, nickname = EXCLUDED.nickname, email = EXCLUDED.email, mobile = EXCLUDED.mobile,
      avatar_path = EXCLUDED.avatar_path, company = EXCLUDED.company, country = EXCLUDED.country, city = EXCLUDED.city,
      language_code = EXCLUDED.language_code, enabled = EXCLUDED.enabled, roles = EXCLUDED.roles,
      permissions = EXCLUDED.permissions, last_login_at = CASE WHEN $14 THEN now() ELSE admins.last_login_at END,
      last_synced_at = now(), updated_at = now()
    RETURNING id
  `, [
    detail.externalUserId, detail.username, detail.nickname, detail.email, detail.mobile, detail.avatarPath,
    detail.company, detail.country, detail.city, detail.languageCode, detail.enabled, detail.roles, detail.permissions, updateLoginTime,
  ]);
  const localId = result.rows[0]?.id;
  if (!localId) throw new Error('Administrator synchronization did not return an ID');
  return localId;
}

export async function registerAdminAuthRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis): Promise<void> {
  app.post('/auth/login', {
    schema: {
      tags: ['admin-auth'],
      body: { type: 'object', required: ['username', 'password'], additionalProperties: false, properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } } },
    },
  }, async request => {
    const { username, password } = request.body as { username: string; password: string };
    const login = await loginExternal(config, 'admin', username, password);
    const detail = await fetchExternalUserDetail(config, login.username, login.externalJwt);
    if (detail.externalUserId !== login.externalUserId) throw errorWithStatus('External user identity mismatch', 502);
    if (!detail.enabled) throw errorWithStatus('Account is disabled', 403);
    checkAdminRole(detail.roles);
    const localId = await syncAdmin(pool, detail, true);
    const expiresAt = jwtExpiresAt(login.externalJwt, config.sessionTtlSeconds);
    const accessToken = await createSession(redis, {
      site: 'admin', localId, externalUserId: detail.externalUserId, username: detail.username,
      externalJwtCiphertext: encryptJwt(login.externalJwt, config.sessionSecret),
    }, config.sessionTtlSeconds, expiresAt);
    const user: CurrentUser = toCurrentUser(localId, detail, 'admin');
    return { code: 0, message: 'ok', data: { accessToken, expiresAt, user } };
  });

  app.post('/auth/logout', async request => {
    const token = authorizationToken(request.headers.authorization);
    if (token) await destroySession(redis, token);
    return { code: 0 };
  });
}
