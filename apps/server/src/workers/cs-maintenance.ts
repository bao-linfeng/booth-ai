import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Logger } from '../infra/logger.js';
import { ineligibleActiveAgents, requeueAgentConversations } from '../modules/customer-service/agents.js';
import { removeAgent } from '../modules/customer-service/presence.js';
import { runRetention } from '../modules/customer-service/retention.js';

export async function runCsRetention(database: Pick<pg.Pool, 'query'>, log: Logger) {
  const result = await runRetention(database);
  if (result.messages || result.conversations || result.visitors) log.info({ retention: result }, 'Customer service retention applied');
  return result;
}

/** 坐席巡检：已停用或失去回复权限的坐席，把其进行中会话退回队列（覆盖坐席没有打开工作台的情况） */
export async function sweepCsAgents(database: pg.Pool, redis: Redis, log: Logger) {
  let requeued = 0;
  for (const adminId of await ineligibleActiveAgents(database)) {
    await removeAgent(redis, adminId);
    requeued += await requeueAgentConversations(database, redis, adminId);
  }
  if (requeued) log.warn({ requeued }, 'Customer service conversations returned to queue after agent became unavailable');
  return requeued;
}
