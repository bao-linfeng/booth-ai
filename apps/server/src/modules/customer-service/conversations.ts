import type pg from 'pg';
import type { Redis } from 'ioredis';
import { transaction } from '../../infra/database.js';
import { eligibleAgent } from './agents.js';
import { resolveContext, type ResolvedContext } from './contexts.js';
import {
  conversationColumns,
  conversationJoins,
  csError,
  notFound,
  subjectCondition,
  subjectKey,
  toAdminConversation,
  toContext,
  toCustomerConversation,
  toCustomerMessage,
  type AdminConversationDto,
  type ContextDto,
  type ContextInput,
  type ContextRow,
  type ConversationRow,
  type CsLocale,
  type EntryPoint,
  type Subject,
} from './domain.js';
import { publishAgents, publishCustomer, type AgentEventType } from './events.js';
import { agentsOnline } from './presence.js';
import { insertEventMessage, insertMessage, loadConversation, loadMessages } from './store.js';

// 会话：打开/复用、客户当前会话、工作台列表与详情、抢接/释放/改派/结束（设计 §3、计划 §6.4）。整个模块不读写 projects 与 project_events。
type Db = Pick<pg.Pool, 'query'>;

export interface Viewer {
  adminId: string;
  supervise: boolean;
}

export async function loadContexts(db: Db, conversationId: string): Promise<ContextDto[]> {
  return (
    await db.query<ContextRow>(
      `SELECT id, kind, ref, entry_point AS "entryPoint", snapshot, created_at AS "createdAt"
    FROM cs_conversation_contexts WHERE conversation_id=$1 ORDER BY created_at, id`,
      [conversationId],
    )
  ).rows.map(toContext);
}

/**
 * 发布变更：新消息推给客户（仅 public）和工作台；会话状态变化推给客户；工作台事件按坐席发布，
 * extraAgentIds 用于改派时通知原坐席刷新列表。
 */
export async function announce(
  pool: Db,
  redis: Redis,
  conversationId: string,
  change: {
    messageIds?: string[];
    conversationChanged?: boolean;
    agentEvent?: AgentEventType;
    extraAgentIds?: (string | null)[];
  },
): Promise<void> {
  const conversation = await loadConversation(pool, conversationId);
  if (!conversation) return;
  const { row } = conversation;
  for (const message of await loadMessages(pool, change.messageIds ?? [])) {
    const dto = toCustomerMessage(message);
    if (dto) await publishCustomer(redis, conversationId, { type: 'message.created', message: dto });
    await publishAgents(redis, {
      type: 'message.created',
      conversationId,
      status: row.status,
      agentAdminId: row.agentAdminId,
      seq: Number(message.seq),
      senderType: message.senderType,
      kind: message.kind,
    });
  }
  if (change.conversationChanged)
    await publishCustomer(redis, conversationId, { type: 'conversation.updated', conversation: conversation.customer });
  if (change.agentEvent) {
    for (const agentAdminId of new Set([row.agentAdminId, ...(change.extraAgentIds ?? [])])) {
      await publishAgents(redis, { type: change.agentEvent, conversationId, status: row.status, agentAdminId });
    }
  }
}

/**
 * 追加一张上下文卡片消息：同一会话内相同上下文复用已有快照记录（冲突时做一次无变化更新以取回 id，不改写早先卡片引用的快照），
 * 卡片消息每次都新增一条。
 */
async function appendContextCard(
  client: pg.PoolClient,
  conversationId: string,
  resolved: ResolvedContext,
  entryPoint: EntryPoint,
  locale: CsLocale,
) {
  const contextId = (
    await client.query<{ id: string }>(
      `INSERT INTO cs_conversation_contexts(conversation_id,kind,ref,project_id,entry_point,customer_locale,snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (conversation_id,kind,ref) DO UPDATE SET ref=EXCLUDED.ref RETURNING id`,
      [conversationId, resolved.kind, resolved.ref, resolved.projectId, entryPoint, locale, JSON.stringify(resolved.snapshot)],
    )
  ).rows[0]!.id;
  return (await insertMessage(client, conversationId, { senderType: 'system', kind: 'context', visibility: 'public', locale, contextId }))
    .id;
}

/** 打开或复用未结束会话；带上下文时每次都追加一张卡片（客户点“咨询客服”即发送，设计 §6.1） */
export async function openConversation(
  pool: pg.Pool,
  redis: Redis,
  subject: Subject,
  input: { context?: ContextInput; entryPoint: EntryPoint },
  locale: CsLocale,
) {
  const resolved = input.context ? await resolveContext(pool, subject, input.context) : null;
  const result = await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`cs-open:${subjectKey(subject)}`]);
    const [condition, subjectId] = subjectCondition(subject, 'c', 1);
    let id = (
      await client.query<{ id: string }>(
        `SELECT c.id FROM cs_conversations c WHERE ${condition} AND c.status<>'closed' AND c.deleted_at IS NULL
      FOR UPDATE`,
        [subjectId],
      )
    ).rows[0]?.id;
    const created = !id;
    if (!id) {
      id = (
        await client.query<{ id: string }>(
          `INSERT INTO cs_conversations(${subject.kind === 'user' ? 'customer_user_id' : 'visitor_id'},customer_locale)
        VALUES($1,$2) RETURNING id`,
          [subjectId, locale],
        )
      ).rows[0]!.id;
    }
    const messageId = resolved ? await appendContextCard(client, id, resolved, input.entryPoint, locale) : null;
    return { id, created, messageId };
  });
  if (result.messageId) await announce(pool, redis, result.id, { messageIds: [result.messageId] });
  const conversation = await loadConversation(pool, result.id);
  return {
    created: result.created,
    conversation: conversation!.customer,
    contexts: await loadContexts(pool, result.id),
    agentsOnline: await agentsOnline(redis),
  };
}

/**
 * 客户手动发送上下文卡片（如客服输入框上的“发送当前方案/项目”）：每次都追加一条卡片消息，同一上下文复用已有快照记录。
 * 只发到本人未结束的会话，已结束时返回 CONVERSATION_CLOSED，由前端开启新一轮后重发。
 */
export async function sendContext(
  pool: pg.Pool,
  redis: Redis,
  subject: Subject,
  conversationId: string,
  input: { context: ContextInput; entryPoint: EntryPoint },
  locale: CsLocale,
) {
  const resolved = await resolveContext(pool, subject, input.context);
  const messageId = await transaction(pool, async client => {
    const [condition, subjectId] = subjectCondition(subject, 'c', 2);
    const row = (
      await client.query<{ status: ConversationRow['status'] }>(
        `SELECT c.status FROM cs_conversations c
      WHERE c.id=$1 AND ${condition} AND c.deleted_at IS NULL FOR UPDATE`,
        [conversationId, subjectId],
      )
    ).rows[0];
    if (!row) throw notFound();
    if (row.status === 'closed') throw csError('CONVERSATION_CLOSED');
    return appendContextCard(client, conversationId, resolved, input.entryPoint, locale);
  });
  await announce(pool, redis, conversationId, { messageIds: [messageId] });
  const [message] = await loadMessages(pool, [messageId]);
  const conversation = await loadConversation(pool, conversationId);
  return { message: toCustomerMessage(message!)!, conversation: conversation!.customer };
}

export async function currentConversation(pool: Db, redis: Redis, subject: Subject) {
  const [condition, subjectId] = subjectCondition(subject, 'c', 1);
  const row = (
    await pool.query<ConversationRow>(
      `SELECT ${conversationColumns} FROM cs_conversations c ${conversationJoins}
    WHERE ${condition} AND c.status<>'closed' AND c.deleted_at IS NULL`,
      [subjectId],
    )
  ).rows[0];
  const unread = (
    await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM cs_messages m JOIN cs_conversations c ON c.id=m.conversation_id
    WHERE ${condition} AND c.deleted_at IS NULL AND m.deleted_at IS NULL AND m.visibility='public' AND m.sender_type='agent' AND m.seq > c.customer_read_seq`,
      [subjectId],
    )
  ).rows[0]!.count;
  return {
    conversation: row ? toCustomerConversation(row) : null,
    contexts: row ? await loadContexts(pool, row.id) : [],
    unreadCount: unread,
    agentsOnline: await agentsOnline(redis),
  };
}

/** 客户主体的会话（任意状态），用于已读、事件票据等；不属于主体时 404 */
export async function ownedConversation(db: Db, subject: Subject, conversationId: string): Promise<ConversationRow> {
  const [condition, subjectId] = subjectCondition(subject, 'c', 2);
  const row = (
    await db.query<ConversationRow>(
      `SELECT ${conversationColumns} FROM cs_conversations c ${conversationJoins}
    WHERE c.id=$1 AND ${condition} AND c.deleted_at IS NULL`,
      [conversationId, subjectId],
    )
  ).rows[0];
  if (!row) throw notFound();
  return row;
}

// ---------------------------------------------------------------- 工作台

/** 他人进行中的会话只有主管可见，其他人看到 404（不泄露存在性） */
export function visibleTo(row: Pick<ConversationRow, 'status' | 'agentAdminId'>, viewer: Viewer): boolean {
  return viewer.supervise || row.status !== 'active' || row.agentAdminId === viewer.adminId;
}

const adminExtras = `(SELECT left(m.body,100) FROM cs_messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL AND m.kind IN ('text','offline','note')
    ORDER BY m.seq DESC LIMIT 1) AS "lastMessagePreview",
  (SELECT count(*)::int FROM cs_messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL AND m.sender_type='customer' AND m.seq > c.agent_read_seq) AS "unreadCount",
  ARRAY(SELECT CASE WHEN x.kind='scheme' THEN '方案 ' || (x.snapshot->>'schemeCode') ELSE '项目 ' || (x.snapshot->>'projectNo') END
    FROM cs_conversation_contexts x WHERE x.conversation_id=c.id ORDER BY x.created_at, x.id) AS "contextSummary"`;

export type ConversationTab = 'queue' | 'mine' | 'offline' | 'all' | 'closed';
const tabs: Record<ConversationTab, { where: string; order: string }> = {
  queue: { where: "c.status='queued' AND c.awaiting_since IS NOT NULL", order: 'c.awaiting_since, c.id' },
  mine: { where: "c.status='active' AND c.agent_admin_id=$1", order: 'c.last_message_at DESC NULLS LAST, c.id' },
  offline: { where: "c.status='queued' AND c.has_offline_message", order: 'c.awaiting_since NULLS LAST, c.id' },
  all: { where: 'true', order: 'c.last_message_at DESC NULLS LAST, c.id' },
  closed: { where: "c.status='closed'", order: 'c.closed_at DESC, c.id' },
};

export async function conversationCounts(db: Db, adminId: string) {
  return (
    await db.query<{ queue: number; mine: number; offline: number }>(
      `SELECT
      count(*) FILTER (WHERE ${tabs.queue.where})::int AS queue, count(*) FILTER (WHERE ${tabs.mine.where})::int AS mine,
      count(*) FILTER (WHERE ${tabs.offline.where})::int AS offline
    FROM cs_conversations c WHERE c.deleted_at IS NULL AND c.status<>'closed'`,
      [adminId],
    )
  ).rows[0]!;
}

export async function listConversations(
  db: Db,
  viewer: Viewer,
  query: { tab: ConversationTab; page: number; pageSize: number; projectId?: string },
) {
  if (query.tab === 'all' && !query.projectId && !viewer.supervise) throw csError('ACCESS_DENIED', 403);
  const tab = tabs[query.tab];
  // 按项目反查时忽略页签，列出挂有该项目上下文的全部会话（他人进行中的会话需要 supervise）
  const where = query.projectId
    ? `EXISTS (SELECT 1 FROM cs_conversation_contexts x WHERE x.conversation_id=c.id AND x.project_id=$4) AND ($5 OR c.status<>'active' OR c.agent_admin_id=$1)`
    : tab.where;
  const order = query.projectId ? 'c.created_at DESC, c.id' : tab.order;
  const params: unknown[] = [
    viewer.adminId,
    query.pageSize,
    (query.page - 1) * query.pageSize,
    ...(query.projectId ? [query.projectId, viewer.supervise] : []),
  ];
  const rows = (
    await db.query<ConversationRow & { total: number }>(
      `SELECT ${conversationColumns}, ${adminExtras}, count(*) OVER()::int AS total
    FROM cs_conversations c ${conversationJoins} WHERE c.deleted_at IS NULL AND $1::uuid IS NOT NULL AND ${where} ORDER BY ${order} LIMIT $2 OFFSET $3`,
      params,
    )
  ).rows; // $1 只有部分页签用到，这里显式声明类型
  return { items: rows.map(toAdminConversation), total: rows[0]?.total ?? 0, counts: await conversationCounts(db, viewer.adminId) };
}

async function adminConversation(db: Db, id: string): Promise<ConversationRow | null> {
  return (
    (
      await db.query<ConversationRow>(
        `SELECT ${conversationColumns}, ${adminExtras} FROM cs_conversations c ${conversationJoins}
    WHERE c.id=$1 AND c.deleted_at IS NULL`,
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function getConversationDetail(db: Db, viewer: Viewer, id: string) {
  const row = await adminConversation(db, id);
  if (!row || !visibleTo(row, viewer)) throw notFound();
  const projects = (
    await db.query<{ projectId: string; projectNo: string; assigneeName: string | null }>(
      `SELECT p.id AS "projectId", p.project_no AS "projectNo",
      COALESCE(NULLIF(btrim(a.nickname),''), a.username) AS "assigneeName"
    FROM cs_conversation_contexts x JOIN projects p ON p.id=x.project_id LEFT JOIN admins a ON a.id=p.assignee_admin_id
    WHERE x.conversation_id=$1 ORDER BY x.created_at, x.id`,
      [id],
    )
  ).rows;
  const owner = row.customerUserId ? 'c.customer_user_id=$2' : 'c.visitor_id=$2';
  const history = (
    await db.query<ConversationRow>(
      `SELECT ${conversationColumns}, ${adminExtras} FROM cs_conversations c ${conversationJoins}
    WHERE ${owner} AND c.id<>$1 AND c.deleted_at IS NULL AND ($3 OR c.status<>'active' OR c.agent_admin_id=$4)
    ORDER BY c.created_at DESC LIMIT 20`,
      [id, row.customerUserId ?? row.visitorId, viewer.supervise, viewer.adminId],
    )
  ).rows;
  return {
    conversation: toAdminConversation(row),
    contexts: await loadContexts(db, id),
    projects,
    history: history.map(toAdminConversation),
  };
}

/** 事务内锁定会话并校验可见性 */
async function lockForAdmin(client: Db, viewer: Viewer, id: string): Promise<ConversationRow> {
  const row = (
    await client.query<ConversationRow>(
      `SELECT ${conversationColumns} FROM cs_conversations c ${conversationJoins}
    WHERE c.id=$1 AND c.deleted_at IS NULL FOR UPDATE OF c`,
      [id],
    )
  ).rows[0];
  if (!row || !visibleTo(row, viewer)) throw notFound();
  return row;
}

async function agentName(db: Db, adminId: string): Promise<string | null> {
  return (
    (await db.query<{ name: string | null }>("SELECT NULLIF(btrim(nickname),'') AS name FROM admins WHERE id=$1", [adminId])).rows[0]
      ?.name ?? null
  );
}

async function adminView(db: Db, id: string): Promise<AdminConversationDto> {
  return toAdminConversation((await adminConversation(db, id))!);
}

export async function claimConversation(pool: pg.Pool, redis: Redis, viewer: Viewer, id: string) {
  const messageId = await transaction(pool, async client => {
    if (!(await eligibleAgent(client, viewer.adminId))) throw csError('AGENT_UNAVAILABLE');
    const updated = await client.query(
      `UPDATE cs_conversations SET status='active', agent_admin_id=$2, claimed_at=now(), awaiting_since=NULL
      WHERE id=$1 AND status='queued' AND deleted_at IS NULL`,
      [id, viewer.adminId],
    );
    if (updated.rowCount !== 1) {
      // 抢接冲突要明确告知（队列对所有坐席可见），不按他人会话的可见性隐藏
      const row = (
        await client.query<Pick<ConversationRow, 'status'>>('SELECT status FROM cs_conversations WHERE id=$1 AND deleted_at IS NULL', [id])
      ).rows[0];
      if (!row) throw notFound();
      throw csError(row.status === 'closed' ? 'CONVERSATION_CLOSED' : 'CONVERSATION_ALREADY_CLAIMED');
    }
    return (await insertEventMessage(client, id, 'claimed', { agentName: await agentName(client, viewer.adminId) })).id;
  });
  // 队列变化对所有坐席可见（agentAdminId=null），本人会话事件只发给接入坐席
  await announce(pool, redis, id, {
    messageIds: [messageId],
    conversationChanged: true,
    agentEvent: 'queue.changed',
    extraAgentIds: [null],
  });
  return { conversation: await adminView(pool, id) };
}

export async function releaseConversation(pool: pg.Pool, redis: Redis, viewer: Viewer, id: string) {
  const messageId = await transaction(pool, async client => {
    const row = await lockForAdmin(client, viewer, id);
    if (row.status !== 'active' || row.agentAdminId !== viewer.adminId) throw csError('NOT_CONVERSATION_AGENT');
    await client.query(
      `UPDATE cs_conversations SET status='queued', agent_admin_id=NULL, awaiting_since=now(), queued_at=now() WHERE id=$1`,
      [id],
    );
    return (await insertEventMessage(client, id, 'released', {})).id;
  });
  await announce(pool, redis, id, {
    messageIds: [messageId],
    conversationChanged: true,
    agentEvent: 'queue.changed',
    extraAgentIds: [viewer.adminId],
  });
  return { conversation: await adminView(pool, id) };
}

/** 主管改派：指定有效坐席，或不传 adminId 退回队列；原因只给后台看，客户端只显示“已为您转接” */
export async function transferConversation(
  pool: pg.Pool,
  redis: Redis,
  viewer: Viewer,
  id: string,
  input: { adminId?: string | null; reason: string },
) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw csError('TRANSFER_REASON_REQUIRED', 400);
  const result = await transaction(pool, async client => {
    const row = await lockForAdmin(client, viewer, id);
    if (row.status === 'closed') throw csError('CONVERSATION_CLOSED');
    const fromAgentName = row.agentAdminId ? ((await agentName(client, row.agentAdminId)) ?? row.agentUsername) : null;
    if (input.adminId) {
      if (!(await eligibleAgent(client, input.adminId))) throw csError('AGENT_UNAVAILABLE');
      await client.query(
        `UPDATE cs_conversations SET status='active', agent_admin_id=$2, claimed_at=now(), awaiting_since=NULL WHERE id=$1`,
        [id, input.adminId],
      );
    } else {
      if (row.status === 'queued') throw csError('CONVERSATION_NOT_ACTIVE');
      await client.query(
        `UPDATE cs_conversations SET status='queued', agent_admin_id=NULL, awaiting_since=now(), queued_at=now() WHERE id=$1`,
        [id],
      );
    }
    const target = input.adminId ? await agentName(client, input.adminId) : null;
    const message = await insertEventMessage(client, id, 'transferred', {
      agentName: target,
      toQueue: !input.adminId,
      reason,
      fromAgentName,
      byAdminId: viewer.adminId,
    });
    return { messageId: message.id, previous: row.agentAdminId };
  });
  await announce(pool, redis, id, {
    messageIds: [result.messageId],
    conversationChanged: true,
    agentEvent: 'queue.changed',
    extraAgentIds: [result.previous, null],
  });
  return { conversation: await adminView(pool, id) };
}

/** 当前坐席或主管可结束；排队中的会话只有主管可结束。离线通知与回复提醒照常发出。 */
export async function closeConversation(pool: pg.Pool, redis: Redis, viewer: Viewer, id: string) {
  const messageId = await transaction(pool, async client => {
    const row = await lockForAdmin(client, viewer, id);
    if (row.status === 'closed') throw csError('CONVERSATION_CLOSED');
    if (!viewer.supervise && (row.status !== 'active' || row.agentAdminId !== viewer.adminId)) throw csError('NOT_CONVERSATION_AGENT');
    await client.query(
      `UPDATE cs_conversations SET status='closed', closed_at=now(), close_reason='agent', awaiting_since=NULL WHERE id=$1`,
      [id],
    );
    return (await insertEventMessage(client, id, 'closed', {})).id;
  });
  await announce(pool, redis, id, { messageIds: [messageId], conversationChanged: true, agentEvent: 'conversation.updated' });
  return { conversation: await adminView(pool, id) };
}
