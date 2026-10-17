import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

export type SessionSite = 'client' | 'admin';

/** 本项目签发的会话；灵通 JWT 只在登录时用来取资料，不保存。 */
export interface SessionData {
  site: SessionSite;
  localId: string;
  externalUserId: number;
  username: string;
  expiresAt: number;
  loginSource: 'password' | 'sso_token';
  sessionVersion: number;
}

function tokenKey(token: string): string {
  const digest = createHash('sha256').update(token).digest('hex').slice(0, 32);
  return `session:${digest}`;
}

export async function createSession(
  redis: Redis,
  data: Omit<SessionData, 'expiresAt'>,
  ttlSeconds: number,
  expiresAt: number,
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const payload: SessionData = { ...data, expiresAt };
  await redis.set(tokenKey(token), JSON.stringify(payload), 'EX', ttlSeconds);
  return token;
}

export async function getSession(redis: Redis, token: string, site: SessionSite): Promise<SessionData | null> {
  const key = tokenKey(token);
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SessionData;
    if (
      (data.site !== 'client' && data.site !== 'admin') ||
      typeof data.localId !== 'string' ||
      !data.localId ||
      !Number.isSafeInteger(data.sessionVersion) ||
      data.sessionVersion < 1 ||
      !Number.isSafeInteger(data.expiresAt) ||
      data.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      await redis.del(key);
      return null;
    }
    if (data.site !== site) return null;
    return data;
  } catch {
    await redis.del(key);
    return null;
  }
}

export async function destroySession(redis: Redis, token: string): Promise<void> {
  await redis.del(tokenKey(token));
}
