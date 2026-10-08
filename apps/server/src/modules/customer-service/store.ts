import type pg from 'pg';
import {
  conversationColumns, conversationJoins, messageColumns, messageJoins, toCustomerConversation,
  type ConversationDto, type ConversationRow, type CsLocale, type EventCode, type MessageRow,
} from './domain.js';

// 会话与消息的底层读写，供会话、消息、访客合并与 Worker 共用。写入必须在已锁定会话行的事务内进行，保证同一会话的 seq 与提交顺序一致。
type Db = Pick<pg.Pool, 'query'>;

export interface NewMessage {
  senderType: 'customer' | 'agent' | 'system'; senderAdminId?: string | null; kind: 'text' | 'offline' | 'note' | 'context' | 'event';
  visibility: 'public' | 'internal'; body?: string; locale: CsLocale; contextId?: string | null;
  eventCode?: EventCode | null; eventParams?: Record<string, unknown> | null; clientMessageId?: string | null;
}

export async function insertMessage(client: Db, conversationId: string, message: NewMessage): Promise<{ id: string; seq: string }> {
  const row = (await client.query<{ id: string; seq: string }>(`INSERT INTO cs_messages(conversation_id,sender_type,sender_admin_id,kind,visibility,body,locale,
      context_id,event_code,event_params,client_message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, seq`,
  [conversationId, message.senderType, message.senderAdminId ?? null, message.kind, message.visibility, message.body ?? '', message.locale,
    message.contextId ?? null, message.eventCode ?? null, message.eventParams ? JSON.stringify(message.eventParams) : null, message.clientMessageId ?? null])).rows[0]!;
  await client.query(`UPDATE cs_conversations SET last_message_seq=$2, last_message_at=now(),
    last_public_seq=CASE WHEN $3 THEN $2 ELSE last_public_seq END WHERE id=$1`, [conversationId, row.seq, message.visibility === 'public']);
  return row;
}

/** 系统事件消息：只存 event_code + event_params，由前端按 i18n 渲染（计划 G8） */
export async function insertEventMessage(client: Db, conversationId: string, eventCode: EventCode, eventParams: Record<string, unknown>,
  visibility: 'public' | 'internal' = 'public'): Promise<{ id: string; seq: string }> {
  const locale = (await client.query<{ locale: CsLocale }>('SELECT customer_locale AS locale FROM cs_conversations WHERE id=$1', [conversationId])).rows[0]!.locale;
  return insertMessage(client, conversationId, { senderType: 'system', kind: 'event', visibility, locale, eventCode, eventParams });
}

export async function loadConversation(db: Db, id: string): Promise<{ row: ConversationRow; customer: ConversationDto } | null> {
  const row = (await db.query<ConversationRow>(`SELECT ${conversationColumns} FROM cs_conversations c ${conversationJoins}
    WHERE c.id=$1 AND c.deleted_at IS NULL`, [id])).rows[0];
  return row ? { row, customer: toCustomerConversation(row) } : null;
}

export async function loadMessages(db: Db, ids: string[]): Promise<MessageRow[]> {
  if (ids.length === 0) return [];
  return (await db.query<MessageRow>(`SELECT ${messageColumns} FROM cs_messages m JOIN cs_conversations c ON c.id=m.conversation_id ${messageJoins}
    WHERE m.id=ANY($1::uuid[]) ORDER BY m.seq`, [ids])).rows;
}
