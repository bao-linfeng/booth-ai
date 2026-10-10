import type pg from 'pg';

// 保留期（设计 §8.4、D6）：6 个月到期逻辑删除，所有接口都带 deleted_at IS NULL；数据库仍保留原文，物理清除另行确定。
// 判定只依赖时间、可重复执行（计划 G2：每小时执行一次）。
const BATCH = 1000;
const pending = 'sent_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL';

async function drain(db: Pick<pg.Pool, 'query'>, sql: string, after?: (ids: string[]) => Promise<void>): Promise<number> {
  let total = 0;
  for (;;) {
    const ids = (await db.query<{ id: string }>(sql, [BATCH])).rows.map(row => row.id);
    if (ids.length) await after?.(ids);
    total += ids.length;
    if (ids.length < BATCH) return total;
  }
}

export async function runRetention(db: Pick<pg.Pool, 'query'>): Promise<{ messages: number; conversations: number; visitors: number }> {
  const failTranslations = async (ids: string[]) => {
    await db.query(
      `UPDATE cs_message_translations SET status='failed', last_error_code='RETENTION', updated_at=now()
      WHERE status='pending' AND message_id=ANY($1::uuid[])`,
      [ids],
    );
  };
  const messages = await drain(
    db,
    `UPDATE cs_messages SET deleted_at=now() WHERE id IN (SELECT id FROM cs_messages
    WHERE deleted_at IS NULL AND created_at < now() - interval '6 months' LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING id`,
    failTranslations,
  );
  const conversations = await drain(
    db,
    `UPDATE cs_conversations SET deleted_at=now() WHERE id IN (SELECT id FROM cs_conversations
    WHERE deleted_at IS NULL AND status='closed' AND COALESCE(last_message_at, created_at) < now() - interval '6 months' LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING id`,
    async ids => {
      await db.query(`UPDATE cs_email_outbox SET cancelled_at=now() WHERE conversation_id=ANY($1::uuid[]) AND ${pending}`, [ids]);
      await db.query(
        `UPDATE cs_message_translations t SET status='failed', last_error_code='RETENTION', updated_at=now() FROM cs_messages m
      WHERE t.message_id=m.id AND t.status='pending' AND m.conversation_id=ANY($1::uuid[])`,
        [ids],
      );
    },
  );
  const visitors = await drain(
    db,
    `UPDATE cs_visitors SET deleted_at=now() WHERE id IN (SELECT v.id FROM cs_visitors v
    WHERE v.deleted_at IS NULL AND v.last_seen_at < now() - interval '6 months'
      AND NOT EXISTS (SELECT 1 FROM cs_conversations c WHERE c.visitor_id=v.id AND c.deleted_at IS NULL) LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING id`,
  );
  return { messages, conversations, visitors };
}
