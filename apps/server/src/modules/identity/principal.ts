import type pg from 'pg';
import type { Redis } from 'ioredis';
import { destroySession, getSession, type SessionData, type SessionSite } from '../../infra/session.js';

export interface Principal {
  site: SessionSite;
  localId: string;
  roles: string[];
  session: SessionData;
  token: string;
}

export function authenticationError(statusCode = 401, reason = 'AUTH_REQUIRED') {
  return Object.assign(new Error('Authentication failed'), { statusCode, reason });
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
  if (!account?.enabled || (site === 'admin' && !account.roles.includes('ROLE_ADMIN'))) {
    await destroySession(redis, token);
    throw authenticationError(403, 'ACCESS_DENIED');
  }
  if (account.sessionVersion !== session.sessionVersion) {
    await destroySession(redis, token);
    throw authenticationError();
  }
  return { site, localId: session.localId, roles: account.roles, session, token };
}
