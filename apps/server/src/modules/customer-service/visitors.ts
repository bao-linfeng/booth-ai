import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../infra/database.js';
import type { CsLocale } from './domain.js';
import { publishAgents, publishCustomer, type CsPublisher } from './events.js';
import { insertEventMessage, loadConversation } from './store.js';

// 访客令牌由服务端签发：32 字节随机串，库中只存 SHA-256。令牌只能访问客服数据（设计 §4）。
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function issueVisitor(db: Pick<pg.Pool, 'query'>, locale: CsLocale): Promise<{ visitorToken: string; visitorId: string }> {
  const visitorToken = randomBytes(32).toString('base64url');
  const row = (
    await db.query<{ id: string }>('INSERT INTO cs_visitors(token_hash,locale) VALUES($1,$2) RETURNING id', [
      hashToken(visitorToken),
      locale,
    ])
  ).rows[0]!;
  return { visitorToken, visitorId: row.id };
}

/** 令牌无效（格式错误、不存在、已删除、已合并）时返回 null；格式错误不查库 */
export async function resolveVisitor(db: Pick<pg.Pool, 'query'>, rawToken: string | string[] | undefined | null): Promise<string | null> {
  if (typeof rawToken !== 'string' || !TOKEN_PATTERN.test(rawToken)) return null;
  return (
    (
      await db.query<{ id: string }>('SELECT id FROM cs_visitors WHERE token_hash=$1 AND deleted_at IS NULL AND merged_user_id IS NULL', [
        hashToken(rawToken),
      ])
    ).rows[0]?.id ?? null
  );
}

export async function visitorActive(db: Pick<pg.Pool, 'query'>, visitorId: string): Promise<boolean> {
  return (
    (await db.query('SELECT 1 FROM cs_visitors WHERE id=$1 AND deleted_at IS NULL AND merged_user_id IS NULL', [visitorId])).rowCount === 1
  );
}

/** 每 5 分钟最多更新一次活跃时间（保留期按 last_seen_at 判定） */
export async function touchVisitor(db: Pick<pg.Pool, 'query'>, visitorId: string): Promise<void> {
  await db.query("UPDATE cs_visitors SET last_seen_at=now() WHERE id=$1 AND last_seen_at < now() - interval '5 minutes'", [visitorId]);
}

/**
 * 访客会话改归登录用户（设计 §4.3）。双方都有未结束会话时保留最后消息较新的一方，另一方结束并写“已合并”。
 * 不转移项目归属：项目仍按已验证邮箱认领。
 */
export async function mergeVisitor(pool: pg.Pool, redis: CsPublisher, userId: string, visitorId: string): Promise<number> {
  const result = await transaction(pool, async client => {
    for (const key of [`cs-open:user:${userId}`, `cs-open:visitor:${visitorId}`].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    }
    const visitor = (
      await client.query<{ id: string }>(
        'SELECT id FROM cs_visitors WHERE id=$1 AND deleted_at IS NULL AND merged_user_id IS NULL FOR UPDATE',
        [visitorId],
      )
    ).rows[0];
    if (!visitor) return null;
    const open = (
      await client.query<{ id: string; visitorId: string | null; lastMessageAt: Date | null; createdAt: Date }>(
        `SELECT id, visitor_id AS "visitorId", last_message_at AS "lastMessageAt", created_at AS "createdAt" FROM cs_conversations
       WHERE (customer_user_id=$1 OR visitor_id=$2) AND status<>'closed' AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [userId, visitorId],
      )
    ).rows;
    let closed: string | null = null;
    if (open.length === 2) {
      const time = (row: (typeof open)[number]) => (row.lastMessageAt ?? row.createdAt).getTime();
      closed = (time(open[0]!) >= time(open[1]!) ? open[1]! : open[0]!).id;
      await client.query(
        `UPDATE cs_conversations SET status='closed', closed_at=now(), close_reason='merged', awaiting_since=NULL WHERE id=$1`,
        [closed],
      );
      await insertEventMessage(client, closed, 'merged', {}, 'public');
      await client.query(
        `UPDATE cs_email_outbox SET cancelled_at=now() WHERE conversation_id=$1 AND kind='reply_notice'
        AND sent_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL`,
        [closed],
      );
    }
    const moved = await client.query<{ id: string }>(
      'UPDATE cs_conversations SET customer_user_id=$1, visitor_id=NULL, origin_visitor_id=$2 WHERE visitor_id=$2 RETURNING id',
      [userId, visitorId],
    );
    await client.query('UPDATE cs_visitors SET merged_user_id=$1, merged_at=now() WHERE id=$2', [userId, visitorId]);
    return { count: moved.rowCount ?? 0, closed };
  });
  if (!result) return 0;
  if (result.closed) {
    const conversation = await loadConversation(pool, result.closed);
    if (conversation) {
      await publishCustomer(redis, result.closed, { type: 'conversation.updated', conversation: conversation.customer });
      await publishAgents(redis, {
        type: 'conversation.updated',
        conversationId: result.closed,
        status: 'closed',
        agentAdminId: conversation.row.agentAdminId,
      });
    }
  }
  return result.count;
}
