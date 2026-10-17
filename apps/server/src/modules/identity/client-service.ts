import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../config.js';
import { fetchExternalUserDetail, loginExternal, type ExternalUserDetail } from '../../infra/external-auth.js';
import { createSession } from '../../infra/session.js';
import { toCurrentUser, type UserType } from './service.js';

interface LocalIdRow {
  id: string;
  enabled: boolean;
  sessionVersion: number;
  type: UserType;
}

function errorWithStatus(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

/** 登录时把灵通资料同步到本地 users；登录后不再回调灵通，资料以本次登录时为准。 */
export async function syncClientUser(
  pool: pg.Pool,
  detail: ExternalUserDetail,
  loginSource: 'password' | 'sso_token',
  type: UserType = 'client',
): Promise<LocalIdRow> {
  const result = await pool.query<LocalIdRow>(
    `
    INSERT INTO users (
      external_user_id, username, nickname, email, mobile, avatar_path, company, country, city, language_code,
      enabled, roles, permissions, last_login_at, last_login_source, last_synced_at, updated_at, user_type
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, now(), now(), $15)
    ON CONFLICT (external_user_id) DO UPDATE SET
      username = EXCLUDED.username, nickname = EXCLUDED.nickname, email = EXCLUDED.email, mobile = EXCLUDED.mobile,
      avatar_path = EXCLUDED.avatar_path, company = EXCLUDED.company, country = EXCLUDED.country, city = EXCLUDED.city,
      language_code = EXCLUDED.language_code, enabled = users.enabled AND EXCLUDED.enabled, roles = EXCLUDED.roles,
      permissions = EXCLUDED.permissions, last_login_at = now(), last_login_source = EXCLUDED.last_login_source,
      user_type = EXCLUDED.user_type, last_synced_at = now(), updated_at = now()
    RETURNING id,enabled,session_version AS "sessionVersion",user_type AS type
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
      detail.permissions,
      loginSource,
      type,
    ],
  );
  const account = result.rows[0];
  if (!account?.id) throw new Error('User synchronization did not return an ID');
  if (!account.enabled) throw errorWithStatus('Account is disabled', 403);
  return account;
}

/**
 * 本地账户同步成功、会话创建之前调用。身份模块不了解其他业务数据；登录后要归属的游客数据由调用方
 * （`modules/client-sign-in`）在这里处理，回调失败时不创建会话。
 */
export type ClientSignedIn = (account: { userId: string; email: string | null; visitorId: string | null }) => Promise<void>;

async function establishClientSession(
  config: Config,
  pool: pg.Pool,
  redis: Redis,
  detail: ExternalUserDetail,
  visitorId: string | null,
  loginSource: 'password' | 'sso_token',
  type: UserType,
  onSignedIn: ClientSignedIn,
) {
  if (!detail.enabled) throw errorWithStatus('Account is disabled', 403);
  const { id: localId, sessionVersion, type: userType } = await syncClientUser(pool, detail, loginSource, type);
  await onSignedIn({ userId: localId, email: detail.email, visitorId });
  // 会话寿命只看本项目配置，与灵通 JWT 的有效期无关；灵通 JWT 只用于本次登录取资料，不保存
  const expiresAt = Math.floor(Date.now() / 1000) + config.sessionTtlSeconds;
  const accessToken = await createSession(
    redis,
    {
      site: 'client',
      localId,
      externalUserId: detail.externalUserId,
      username: detail.username,
      loginSource,
      sessionVersion,
    },
    config.sessionTtlSeconds,
    expiresAt,
  );
  return { accessToken, expiresAt, user: toCurrentUser(localId, detail, 'client', loginSource, userType) };
}

export async function loginClient(
  config: Config,
  pool: pg.Pool,
  redis: Redis,
  username: string,
  password: string,
  visitorId: string | null,
  onSignedIn: ClientSignedIn,
) {
  const login = await loginExternal(config, 'client', username, password);
  const detail = await fetchExternalUserDetail(config, login.username, login.externalJwt);
  if (detail.externalUserId !== login.externalUserId) throw errorWithStatus('External user identity mismatch', 502);
  return establishClientSession(config, pool, redis, detail, visitorId, 'password', 'client', onSignedIn);
}

export async function syncClientSession(
  config: Config,
  pool: pg.Pool,
  redis: Redis,
  username: string,
  token: string,
  visitorId: string | null,
  type: UserType,
  onSignedIn: ClientSignedIn,
) {
  let subject: unknown;
  let tokenExpiresAt: number;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) throw new Error('Invalid token');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown };
    subject = payload.sub;
    if (typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error('Expired token');
    }
    tokenExpiresAt = payload.exp;
  } catch {
    throw errorWithStatus('Invalid external token', 401);
  }
  if (subject !== username) throw errorWithStatus('External user identity mismatch', 401);
  const detail = await fetchExternalUserDetail(config, username, token);
  if (detail.username !== subject) throw errorWithStatus('External user identity mismatch', 401);
  if (tokenExpiresAt <= Math.floor(Date.now() / 1000)) throw errorWithStatus('Expired external token', 401);
  return establishClientSession(config, pool, redis, detail, visitorId, 'sso_token', type, onSignedIn);
}
