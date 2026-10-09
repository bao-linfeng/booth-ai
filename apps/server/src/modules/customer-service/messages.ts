import type pg from 'pg';
import type { Redis } from 'ioredis';
import { transaction } from '../../infra/database.js';
import { eligibleAgent } from './agents.js';
import { announce, type Viewer, visibleTo } from './conversations.js';
import {
  conversationColumns, conversationJoins, csError, messageColumns, messageJoins, normalizeBody, normalizeEmail, notFound, subjectCondition,
  toAdminMessage, toCustomerMessage, type ConversationRow, type CsLocale, type MessageDto, type MessageRow, type Subject,
} from './domain.js';
import { cancelReplyNotices, enqueueOfflineNotice, scheduleReplyNotice } from './emails.js';
import { publishAgents, publishCustomer } from './events.js';
import { insertMessage, loadConversation, loadMessages } from './store.js';
import { queueTranslation } from './translation.js';

// 消息：客户/坐席发送（clientMessageId 幂等）、时间线分页、已读（计划 §6.4）。消息先落库后推送。
type Db = Pick<pg.Pool, 'query'>;

export interface Page { before?: number; after?: number; limit: number }

function pageClause(page: Page, first: number): { where: string; order: string; params: unknown[] } {
  if (page.before !== undefined && page.after !== undefined) throw csError('CURSOR_CONFLICT', 400);
  if (page.after !== undefined) return { where: `AND m.seq > $${first}`, order: 'ASC', params: [page.after] };
  if (page.before !== undefined) return { where: `AND m.seq < $${first}`, order: 'DESC', params: [page.before] };
  return { where: '', order: 'DESC', params: [] };
}

async function pageMessages(db: Db, scope: string, scopeParams: unknown[], page: Page) {
  const clause = pageClause(page, scopeParams.length + 1);
  const rows = (await db.query<MessageRow>(`SELECT ${messageColumns} FROM cs_messages m JOIN cs_conversations c ON c.id=m.conversation_id ${messageJoins}
    WHERE ${scope} AND m.deleted_at IS NULL AND c.deleted_at IS NULL ${clause.where}
    ORDER BY m.seq ${clause.order} LIMIT $${scopeParams.length + clause.params.length + 1}`, [...scopeParams, ...clause.params, page.limit + 1])).rows;
  const hasMore = rows.length > page.limit;
  const items = rows.slice(0, page.limit);
  return { items: clause.order === 'DESC' ? items.reverse() : items, hasMore };
}

/** 客户时间线：本主体全部轮次，从不包含 internal 消息 */
export async function listCustomerMessages(db: Db, subject: Subject, page: Page): Promise<{ items: MessageDto[]; hasMore: boolean }> {
  const [condition, subjectId] = subjectCondition(subject, 'c', 1);
  const result = await pageMessages(db, `${condition} AND m.visibility='public'`, [subjectId], page);
  return { items: result.items.map(toCustomerMessage).filter((item): item is MessageDto => item !== null), hasMore: result.hasMore };
}

/** SSE 补发：单个会话 seq 之后的 public 消息 */
export async function customerMessagesAfter(db: Db, conversationId: string, after: number): Promise<MessageDto[]> {
  return (await pageMessages(db, "m.conversation_id=$1 AND m.visibility='public'", [conversationId], { after, limit: 500 })).items
    .map(toCustomerMessage).filter((item): item is MessageDto => item !== null);
}

export async function listAdminMessages(db: Db, viewer: Viewer, conversationId: string, page: Page) {
  const row = (await db.query<Pick<ConversationRow, 'status' | 'agentAdminId'>>(`SELECT status, agent_admin_id AS "agentAdminId" FROM cs_conversations
    WHERE id=$1 AND deleted_at IS NULL`, [conversationId])).rows[0];
  if (!row || !visibleTo(row, viewer)) throw notFound();
  const result = await pageMessages(db, 'm.conversation_id=$1', [conversationId], page);
  return { items: result.items.map(toAdminMessage), hasMore: result.hasMore };
}

async function settings(db: Db) {
  return (await db.query<{ agentLocale: CsLocale; offlineNotifyEmails: string[] }>(
    'SELECT agent_locale AS "agentLocale", offline_notify_emails AS "offlineNotifyEmails" FROM cs_settings WHERE id')).rows[0]!;
}

async function replay(db: Db, conversationId: string, senderType: 'customer' | 'agent', clientMessageId: string, body: string, kind: string) {
  const existing = (await db.query<{ id: string; body: string; kind: string }>(`SELECT id, body, kind FROM cs_messages
    WHERE conversation_id=$1 AND sender_type=$2 AND client_message_id=$3`, [conversationId, senderType, clientMessageId])).rows[0];
  if (!existing) return null;
  // 留言在会话被接入后按 text 落库，重放时视为同一条
  if (existing.body !== body || (existing.kind !== kind && !(kind === 'offline' && existing.kind === 'text'))) throw csError('IDEMPOTENCY_CONFLICT');
  return existing.id;
}

export interface CustomerMessageInput { clientMessageId: string; body: string; kind: 'text' | 'offline'; contactEmail?: string | null }

/**
 * 客户发消息。重放检查在“已结束”判断之前，保证断线重试成功；留言只在排队中生效，否则按普通消息处理。
 * 访客留言必须留邮箱，登录用户未填写时使用账户邮箱。
 */
export async function postCustomerMessage(pool: pg.Pool, redis: Redis, subject: Subject, conversationId: string, input: CustomerMessageInput, locale: CsLocale) {
  const body = normalizeBody(input.body);
  const contactEmail = normalizeEmail(input.contactEmail);
  const result = await transaction(pool, async client => {
    const [condition, subjectId] = subjectCondition(subject, 'c', 2);
    const row = (await client.query<ConversationRow & { accountEmail: string | null }>(`SELECT ${conversationColumns}, u.email AS "accountEmail"
      FROM cs_conversations c ${conversationJoins} WHERE c.id=$1 AND ${condition} AND c.deleted_at IS NULL FOR UPDATE OF c`, [conversationId, subjectId])).rows[0];
    if (!row) throw notFound();
    const replayed = await replay(client, conversationId, 'customer', input.clientMessageId, body, input.kind);
    if (replayed) return { created: false, messageId: replayed, queueChanged: false };
    if (row.status === 'closed') throw csError('CONVERSATION_CLOSED');
    const offline = input.kind === 'offline' && row.status === 'queued';
    const email = contactEmail ?? (offline ? row.contactEmail ?? normalizeEmail(row.accountEmail) : null);
    if (offline && !email) throw csError('CONTACT_EMAIL_REQUIRED', 400);
    const message = await insertMessage(client, conversationId, { senderType: 'customer', kind: offline ? 'offline' : 'text', visibility: 'public',
      body, locale, clientMessageId: input.clientMessageId });
    const updated = (await client.query<{ awaiting: boolean }>(`UPDATE cs_conversations SET customer_locale=$2, contact_email=COALESCE($3, contact_email),
        has_offline_message=has_offline_message OR $4, awaiting_since=CASE WHEN status='queued' THEN COALESCE(awaiting_since, now()) END
      WHERE id=$1 RETURNING $5::boolean AND awaiting_since IS NOT NULL AS awaiting`,
    [conversationId, locale, email, offline, row.status === 'queued' && row.awaitingSince === null])).rows[0]!;
    const config = await settings(client);
    await queueTranslation(client, message.id, locale, config.agentLocale);
    if (offline) await enqueueOfflineNotice(client, conversationId, config.offlineNotifyEmails, config.agentLocale);
    return { created: true, messageId: message.id, queueChanged: updated.awaiting };
  });
  if (result.created) {
    await announce(pool, redis, conversationId, { messageIds: [result.messageId], conversationChanged: true,
      ...(result.queueChanged ? { agentEvent: 'queue.changed' as const } : {}) });
  }
  const [message] = await loadMessages(pool, [result.messageId]);
  const conversation = await loadConversation(pool, conversationId);
  return { created: result.created, message: toCustomerMessage(message!)!, conversation: conversation!.customer };
}

/** 客户已读：只前进不后退，上限为最后一条 public 消息；读完后取消待发的回复提醒 */
export async function markCustomerRead(pool: pg.Pool, redis: Redis, subject: Subject, conversationId: string, seq: number) {
  const [condition, subjectId] = subjectCondition(subject, 'c', 2);
  const row = (await pool.query<{ customerReadSeq: string; allRead: boolean; status: ConversationRow['status']; agentAdminId: string | null }>(
    `UPDATE cs_conversations c SET customer_read_seq=GREATEST(c.customer_read_seq, LEAST($3::bigint, COALESCE(c.last_public_seq,0)))
     WHERE c.id=$1 AND ${condition} AND c.deleted_at IS NULL
     RETURNING c.customer_read_seq AS "customerReadSeq", c.customer_read_seq >= COALESCE(c.last_public_seq,0) AS "allRead", c.status, c.agent_admin_id AS "agentAdminId"`,
    [conversationId, subjectId, seq])).rows[0];
  if (!row) throw notFound();
  if (row.allRead) await cancelReplyNotices(pool, conversationId);
  await publishAgents(redis, { type: 'read', conversationId, status: row.status, agentAdminId: row.agentAdminId });
  return { customerReadSeq: Number(row.customerReadSeq) };
}

export interface AgentMessageInput { clientMessageId: string; body: string; kind: 'text' | 'note' }

/** 坐席发消息：text 只能由当前坐席发送并翻译成客户语言；note 由当前坐席或主管写，客户不可见、不翻译 */
export async function postAgentMessage(pool: pg.Pool, redis: Redis, viewer: Viewer, conversationId: string, input: AgentMessageInput) {
  const body = normalizeBody(input.body);
  const result = await transaction(pool, async client => {
    if (!await eligibleAgent(client, viewer.adminId)) throw csError('AGENT_UNAVAILABLE');
    const row = (await client.query<ConversationRow>(`SELECT ${conversationColumns} FROM cs_conversations c ${conversationJoins}
      WHERE c.id=$1 AND c.deleted_at IS NULL FOR UPDATE OF c`, [conversationId])).rows[0];
    if (!row || !visibleTo(row, viewer)) throw notFound();
    const replayed = await replay(client, conversationId, 'agent', input.clientMessageId, body, input.kind);
    if (replayed) return { created: false, messageId: replayed };
    if (row.status === 'closed') throw csError('CONVERSATION_CLOSED');
    const mine = row.status === 'active' && row.agentAdminId === viewer.adminId;
    if (input.kind === 'text' ? !mine : !(mine || viewer.supervise)) throw csError('NOT_CONVERSATION_AGENT');
    const { agentLocale } = await settings(client);
    const message = await insertMessage(client, conversationId, { senderType: 'agent', senderAdminId: viewer.adminId, kind: input.kind,
      visibility: input.kind === 'note' ? 'internal' : 'public', body, locale: agentLocale, clientMessageId: input.clientMessageId });
    if (mine) await client.query('UPDATE cs_conversations SET agent_read_seq=GREATEST(agent_read_seq,$2) WHERE id=$1', [conversationId, message.seq]);
    if (input.kind === 'text') {
      await queueTranslation(client, message.id, agentLocale, row.customerLocale);
      await scheduleReplyNotice(client, conversationId);
    }
    return { created: true, messageId: message.id };
  });
  if (result.created) await announce(pool, redis, conversationId, { messageIds: [result.messageId] });
  const [message] = await loadMessages(pool, [result.messageId]);
  return { created: result.created, message: toAdminMessage(message!) };
}

export async function markAgentRead(pool: pg.Pool, redis: Redis, viewer: Viewer, conversationId: string, seq: number) {
  const row = (await pool.query<{ agentReadSeq: string; status: ConversationRow['status']; agentAdminId: string | null }>(
    `UPDATE cs_conversations SET agent_read_seq=GREATEST(agent_read_seq, LEAST($2::bigint, COALESCE(last_message_seq,0)))
     WHERE id=$1 AND deleted_at IS NULL AND status='active' AND ($3 OR agent_admin_id=$4)
     RETURNING agent_read_seq AS "agentReadSeq", status, agent_admin_id AS "agentAdminId"`, [conversationId, seq, viewer.supervise, viewer.adminId])).rows[0];
  if (!row) {
    const exists = (await pool.query<Pick<ConversationRow, 'status' | 'agentAdminId'>>(`SELECT status, agent_admin_id AS "agentAdminId" FROM cs_conversations
      WHERE id=$1 AND deleted_at IS NULL`, [conversationId])).rows[0];
    if (!exists || !visibleTo(exists, viewer)) throw notFound();
    throw csError('NOT_CONVERSATION_AGENT');
  }
  const agentReadSeq = Number(row.agentReadSeq);
  await publishCustomer(redis, conversationId, { type: 'read', agentReadSeq });
  await publishAgents(redis, { type: 'read', conversationId, status: row.status, agentAdminId: row.agentAdminId });
  return { agentReadSeq };
}
