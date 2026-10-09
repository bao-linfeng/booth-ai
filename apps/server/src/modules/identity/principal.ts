import type pg from 'pg';
import type { Redis } from 'ioredis';
import { destroySession, getSession, type SessionData, type SessionSite } from '../../infra/session.js';
import { resolveAdminPermissions } from './roles.js';

export interface Principal {
  site: SessionSite;
  localId: string;
  roles: string[];
  permissions: string[];
  session: SessionData;
  token: string;
}

class AuthenticationError extends Error {
  constructor(readonly statusCode: number, readonly reason: string) {
    super('Authentication failed');
  }
}

export function authenticationError(statusCode = 401, reason = 'AUTH_REQUIRED'): AuthenticationError {
  return new AuthenticationError(statusCode, reason);
}

export async function revokeAccountSessions(pool: pg.Pool, site: SessionSite, localId: string): Promise<void> {
  const table = site === 'client' ? 'users' : 'admins';
  await pool.query(`UPDATE ${table} SET session_version=session_version+1 WHERE id=$1`, [localId]);
}

export async function resolvePrincipal(pool: pg.Pool, redis: Redis, token: string, site: SessionSite): Promise<Principal> {
  const session = await getSession(redis, token, site);
  if (!session) throw authenticationError();
  const table = site === 'client' ? 'users' : 'admins';
  const account = (await pool.query<{ enabled: boolean; roles: string[]; sessionVersion: number }>(
    `SELECT enabled,roles,session_version AS "sessionVersion" FROM ${table} WHERE id=$1`, [session.localId],
  )).rows[0];
  if (!account?.enabled) {
    await destroySession(redis, token);
    throw authenticationError(403, 'ACCESS_DENIED');
  }
  if (account.sessionVersion !== session.sessionVersion) {
    await destroySession(redis, token);
    throw authenticationError();
  }
  const permissions = site === 'admin' ? await resolveAdminPermissions(pool, account.roles) : [];
  if (site === 'admin' && permissions.length === 0) {
    await destroySession(redis, token);
    throw authenticationError(403, 'ACCESS_DENIED');
  }
  return { site, localId: session.localId, roles: account.roles, permissions, session, token };
}

/** 长连接复核：按建立时的令牌重新校验 Session 与账户并取最新权限；已失效返回 null，Redis/DB 故障照常抛出 */
export async function revalidatePrincipal(pool: pg.Pool, redis: Redis, principal: Principal): Promise<Principal | null> {
  try {
    return await resolvePrincipal(pool, redis, principal.token, principal.site);
  } catch (error) {
    if (error instanceof AuthenticationError) return null;
    throw error;
  }
}
