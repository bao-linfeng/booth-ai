import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Config } from '../../config.js';
import { fetchExternalUserDetail, loginExternal, type ExternalUserDetail } from '../../infra/external-auth.js';
import { errorCode, logger } from '../../infra/logger.js';
import { createSession } from '../../infra/session.js';
import { toCurrentUser, type CurrentUser } from './service.js';
import { requireAdminAccess, syncAdminRoles } from './roles.js';

/** 登录时把灵通资料同步到本地 admins；登录后不再回调灵通，资料以本次登录时为准。 */
export async function syncAdmin(pool: pg.Pool, detail: ExternalUserDetail): Promise<{ id: string; sessionVersion: number }> {
  const result = await pool.query<{ id: string; enabled: boolean; sessionVersion: number }>(
    `
    INSERT INTO admins (
      external_user_id, username, nickname, email, mobile, avatar_path, company, country, city, language_code,
      enabled, roles, permissions, last_login_at, last_synced_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now(), now())
    ON CONFLICT (external_user_id) DO UPDATE SET
      username = EXCLUDED.username, nickname = EXCLUDED.nickname, email = EXCLUDED.email, mobile = EXCLUDED.mobile,
      avatar_path = EXCLUDED.avatar_path, company = EXCLUDED.company, country = EXCLUDED.country, city = EXCLUDED.city,
      language_code = EXCLUDED.language_code, enabled = admins.enabled AND EXCLUDED.enabled, roles = EXCLUDED.roles,
      permissions = EXCLUDED.permissions, last_login_at = now(),
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
  const { id: localId, sessionVersion } = await syncAdmin(pool, detail);
  // 只由能查看角色页的管理员触发，与原先打开角色页时同步的范围一致；失败不影响登录，角色页沿用已有数据
  if (permissions.includes('roles.read')) {
    await syncAdminRoles(config, pool, login.externalJwt).catch((error: unknown) => {
      logger.warn({ adminId: localId, code: errorCode(error) }, 'Admin role sync failed at login');
    });
  }
  // 会话寿命只看本项目配置；灵通 JWT 用完即弃，不保存
  const expiresAt = Math.floor(Date.now() / 1000) + config.sessionTtlSeconds;
  const accessToken = await createSession(
    redis,
    {
      site: 'admin',
      localId,
      externalUserId: detail.externalUserId,
      username: detail.username,
      loginSource: 'password',
      sessionVersion,
    },
    config.sessionTtlSeconds,
    expiresAt,
  );
  return { accessToken, expiresAt, user: toCurrentUser(localId, { ...detail, permissions }, 'admin', 'password') };
}

/** 管理端当前用户：只读本地 admins 表；权限取请求鉴权时按本地角色解析出的结果。 */
export async function getAdminProfile(
  pool: pg.Pool,
  adminId: string,
  permissions: string[],
  loginSource: 'password' | 'sso_token',
): Promise<CurrentUser | null> {
  const row = (
    await pool.query<Omit<CurrentUser, 'accountType' | 'permissions' | 'lastSyncedAt' | 'loginSource'> & { lastSyncedAt: Date }>(
      `SELECT id, external_user_id::text AS "externalUserId", username, nickname, email, mobile, avatar_path AS "avatarPath",
        company, country, city, language_code AS "languageCode", enabled, roles, last_synced_at AS "lastSyncedAt"
      FROM admins WHERE id=$1`,
      [adminId],
    )
  ).rows[0];
  if (!row) return null;
  return { ...row, accountType: 'admin', permissions, lastSyncedAt: row.lastSyncedAt.toISOString(), loginSource };
}
