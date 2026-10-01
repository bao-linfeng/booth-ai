import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { fetchExternalUserDetail, loginExternal, type ExternalUserDetail } from '../../../infra/external-auth.js';
import { createSession, encryptJwt } from '../../../infra/session.js';
import { linkVisitorToUser } from '../../selection-analytics/service.js';

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

async function establishClientSession(
  config: Config, pool: pg.Pool, redis: Redis, detail: ExternalUserDetail, externalJwt: string, visitorId: string | null,
) {
  if (!detail.enabled) throw errorWithStatus('Account is disabled', 403);
  const localId = await syncClientUser(pool, detail, true);
  if (visitorId) await linkVisitorToUser(pool, visitorId, localId);
  const expiresAt = jwtExpiresAt(externalJwt, config.sessionTtlSeconds);
  const accessToken = await createSession(redis, {
    site: 'client', localId, externalUserId: detail.externalUserId, username: detail.username,
    externalJwtCiphertext: encryptJwt(externalJwt, config.sessionSecret),
  }, config.sessionTtlSeconds, expiresAt);
  return { accessToken, expiresAt, user: toCurrentUser(localId, detail, 'client') };
}

export async function loginClient(
  config: Config, pool: pg.Pool, redis: Redis, username: string, password: string, visitorId: string | null,
) {
  const login = await loginExternal(config, 'client', username, password);
  const detail = await fetchExternalUserDetail(config, login.username, login.externalJwt);
  if (detail.externalUserId !== login.externalUserId) throw errorWithStatus('External user identity mismatch', 502);
  return establishClientSession(config, pool, redis, detail, login.externalJwt, visitorId);
}

export async function syncClientSession(
  config: Config, pool: pg.Pool, redis: Redis, username: string, token: string, visitorId: string | null,
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
  return establishClientSession(config, pool, redis, detail, token, visitorId);
}
