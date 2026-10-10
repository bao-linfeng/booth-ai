import type pg from 'pg';
import type { Redis } from 'ioredis';
import { transaction } from '../../infra/database.js';
import { publishAgents, publishCustomer } from './events.js';
import { onlineAgentIds } from './presence.js';
import { insertEventMessage, loadConversation } from './store.js';

// 坐席不单独建表：账号启用且当前有效角色权限包含 customer-service.read 与 reply 即为有效坐席（设计 §7.1.3），实时查询不缓存。
const AGENT_PERMISSIONS = ['customer-service.read', 'customer-service.reply'];

export function agentPermissionSql(alias: string): string {
  return AGENT_PERMISSIONS.map(
    permission => `EXISTS (SELECT 1 FROM admin_roles r WHERE r.active AND r.name=ANY(${alias}.roles)
    AND '${permission}'=ANY(r.permission_codes))`,
  ).join(' AND ');
}

export async function eligibleAgent(db: Pick<pg.Pool, 'query'>, adminId: string): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM admins a WHERE a.id=$1 AND a.enabled AND ${agentPermissionSql('a')}`, [adminId])).rowCount === 1;
}

export interface AgentDto {
  adminId: string;
  displayName: string;
  online: boolean;
  activeCount: number;
}

export async function listAgents(db: Pick<pg.Pool, 'query'>, redis: Redis): Promise<AgentDto[]> {
  const rows = (
    await db.query<Omit<AgentDto, 'online'>>(`SELECT a.id AS "adminId", COALESCE(NULLIF(btrim(a.nickname),''), a.username) AS "displayName",
      (SELECT count(*)::int FROM cs_conversations c WHERE c.agent_admin_id=a.id AND c.status='active' AND c.deleted_at IS NULL) AS "activeCount"
    FROM admins a WHERE a.enabled AND ${agentPermissionSql('a')} ORDER BY 2, 1`)
  ).rows;
  const online = await onlineAgentIds(redis);
  return rows.map(row => ({ ...row, online: online.has(row.adminId) }));
}

/** 坐席失效：把其全部进行中会话退回队列，并写系统消息“坐席已不可用，会话重新排队” */
export async function requeueAgentConversations(pool: pg.Pool, redis: Redis, adminId: string): Promise<number> {
  const ids = await transaction(pool, async client => {
    const rows = (
      await client.query<{ id: string }>(
        `UPDATE cs_conversations SET status='queued', agent_admin_id=NULL, awaiting_since=now(), queued_at=now()
      WHERE agent_admin_id=$1 AND status='active' AND deleted_at IS NULL RETURNING id`,
        [adminId],
      )
    ).rows;
    for (const row of rows) await insertEventMessage(client, row.id, 'agent_unavailable', {});
    return rows.map(row => row.id);
  });
  for (const id of ids) {
    const conversation = await loadConversation(pool, id);
    if (conversation) await publishCustomer(redis, id, { type: 'conversation.updated', conversation: conversation.customer });
    await publishAgents(redis, { type: 'queue.changed', conversationId: id, status: 'queued', agentAdminId: null });
  }
  return ids.length;
}

/** 有进行中会话但已失效的坐席（Worker 巡检，覆盖坐席没有打开工作台的情况） */
export async function ineligibleActiveAgents(db: Pick<pg.Pool, 'query'>): Promise<string[]> {
  return (
    await db.query<{ id: string }>(`SELECT DISTINCT c.agent_admin_id AS id FROM cs_conversations c JOIN admins a ON a.id=c.agent_admin_id
    WHERE c.status='active' AND c.deleted_at IS NULL AND NOT (a.enabled AND ${agentPermissionSql('a')})`)
  ).rows.map(row => row.id);
}
