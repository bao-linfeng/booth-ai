import type { Redis } from 'ioredis';
import { errorCode, logger } from '../../infra/logger.js';

// 坐席在线：工作台 SSE 存活期间每次心跳续期（ZSET score = 过期时间）；离开状态单独标记 12 小时。
// 客户在线：客户端 SSE 存活期间续期；回复提醒到期时仍有未读且客户在线则顺延（不决定是否入队，也不取消）。
export const PRESENCE_KEY = 'cs:presence';
export const PRESENCE_TTL_MS = 45_000;
const awayKey = (adminId: string) => `cs:agent-away:${adminId}`;
const customerKey = (conversationId: string) => `cs:customer-presence:${conversationId}`;

export async function touchAgent(redis: Redis, adminId: string): Promise<boolean> {
  if (await redis.exists(awayKey(adminId))) return false;
  await redis.zadd(PRESENCE_KEY, Date.now() + PRESENCE_TTL_MS, adminId);
  return true;
}

export async function removeAgent(redis: Redis, adminId: string): Promise<void> {
  await redis.zrem(PRESENCE_KEY, adminId);
}

export async function setAway(redis: Redis, adminId: string, away: boolean): Promise<void> {
  if (away) {
    await redis.set(awayKey(adminId), '1', 'EX', 43_200);
    await redis.zrem(PRESENCE_KEY, adminId);
  } else {
    await redis.del(awayKey(adminId));
    await redis.zadd(PRESENCE_KEY, Date.now() + PRESENCE_TTL_MS, adminId);
  }
}

export async function isAway(redis: Redis, adminId: string): Promise<boolean> {
  return (await redis.exists(awayKey(adminId))) === 1;
}

/** 在线坐席 ID；Redis 不可用时视为无人在线（客户端进入留言模式，比误显示在线更安全） */
export async function onlineAgentIds(redis: Redis): Promise<Set<string>> {
  try {
    const now = Date.now();
    await redis.zremrangebyscore(PRESENCE_KEY, '-inf', now);
    return new Set(await redis.zrangebyscore(PRESENCE_KEY, now, '+inf'));
  } catch (error) {
    logger.warn({ code: errorCode(error) }, 'Customer service presence unavailable');
    return new Set();
  }
}

export async function agentsOnline(redis: Redis): Promise<boolean> {
  return (await onlineAgentIds(redis)).size > 0;
}

export async function touchCustomer(redis: Redis, conversationId: string): Promise<void> {
  await redis.set(customerKey(conversationId), '1', 'EX', 45);
}

/** Redis 不可用时视为不在线，到期的回复提醒照常发送 */
export async function customerOnline(redis: Redis, conversationId: string): Promise<boolean> {
  try {
    return (await redis.exists(customerKey(conversationId))) === 1;
  } catch {
    return false;
  }
}
