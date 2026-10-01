import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

export type SessionSite = 'client' | 'admin';

export interface SessionData {
  site: SessionSite;
  localId: string;
  externalUserId: number;
  username: string;
  externalJwtCiphertext: string;
  expiresAt: number;
  loginSource: 'password' | 'sso_token';
}

function tokenKey(token: string): string {
  const digest = createHash('sha256').update(token).digest('hex').slice(0, 32);
  return `session:${digest}`;
}

export function encryptJwt(jwt: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(jwt, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptJwt(ciphertext: string, secret: string): string {
  const [ivHex, authTagHex, encHex] = ciphertext.split(':');
  if (!ivHex || !authTagHex || !encHex) throw new Error('Invalid ciphertext');
  const key = createHash('sha256').update(secret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
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
    if (data.site !== site || data.expiresAt < Math.floor(Date.now() / 1000)) {
      await redis.del(key);
      return null;
    }
    return data;
  } catch {
    await redis.del(key);
    return null;
  }
}

export async function destroySession(redis: Redis, token: string): Promise<void> {
  await redis.del(tokenKey(token));
}
