import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Config } from '../../config.js';
import { fetchExternalUserDetail, loginExternal, type ExternalUserDetail } from '../../infra/external-auth.js';
import { createSession, encryptJwt } from '../../infra/session.js';
import { jwtExpiresAt, toCurrentUser } from './service.js';
import { requireAdminAccess } from './roles.js';

export async function syncAdmin(
  pool: pg.Pool,
  detail: ExternalUserDetail,
  updateLoginTime: boolean,
): Promise<{ id: string; sessionVersion: number }> {
  const result = await pool.query<{ id: string; enabled: boolean; sessionVersion: number }>(
    `
    INSERT INTO admins (
      external_user_id, username, nickname, email, mobile, avatar_path, company, country, city, language_code,
      enabled, roles, permissions, last_login_at, last_synced_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $14 THEN now() ELSE NULL END, now(), now())
    ON CONFLICT (external_user_id) DO UPDATE SET
      username = EXCLUDED.username, nickname = EXCLUDED.nickname, email = EXCLUDED.email, mobile = EXCLUDED.mobile,
      avatar_path = EXCLUDED.avatar_path, company = EXCLUDED.company, country = EXCLUDED.country, city = EXCLUDED.city,
      language_code = EXCLUDED.language_code, enabled = admins.enabled AND EXCLUDED.enabled, roles = EXCLUDED.roles,
      permissions = EXCLUDED.permissions, last_login_at = CASE WHEN $14 THEN now() ELSE admins.last_login_at END,
      last_synced_at = now(), updated_at = now()
    RETURNING id,enabled,session_version AS "sessionVersion"
  `,
    [
      detail.externalUserId,
      detail.username,
      detail.nickname,
      detail.email,
      detail.mobile,
      detail.avatarPath,
      detail.company,
      detail.country,
      detail.city,
      detail.languageCode,
      detail.enabled,
      detail.roles,
      [],
      updateLoginTime,
    ],
  );
  const account = result.rows[0];
  if (!account?.id) throw new Error('Administrator synchronization did not return an ID');
  if (!account.enabled) throw Object.assign(new Error('Account is disabled'), { statusCode: 403 });
  return account;
}

export async function loginAdmin(config: Config, pool: pg.Pool, redis: Redis, username: string, password: string) {
  const login = await loginExternal(config, 'admin', username, password);
  const detail = await fetchExternalUserDetail(config, login.username, login.externalJwt);
  if (detail.externalUserId !== login.externalUserId)
    throw Object.assign(new Error('External user identity mismatch'), { statusCode: 502 });
  if (!detail.enabled) throw Object.assign(new Error('Account is disabled'), { statusCode: 403 });
  const permissions = await requireAdminAccess(pool, detail.roles);
  const { id: localId, sessionVersion } = await syncAdmin(pool, detail, true);
  const expiresAt = jwtExpiresAt(login.externalJwt, config.sessionTtlSeconds);
  const accessToken = await createSession(
    redis,
    {
      site: 'admin',
      localId,
      externalUserId: detail.externalUserId,
      username: detail.username,
      externalJwtCiphertext: encryptJwt(login.externalJwt, config.sessionSecret),
      loginSource: 'password',
      sessionVersion,
    },
    config.sessionTtlSeconds,
    expiresAt,
  );
  return { accessToken, expiresAt, user: toCurrentUser(localId, { ...detail, permissions }, 'admin', 'password') };
}
