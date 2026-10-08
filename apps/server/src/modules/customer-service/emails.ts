import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { CsLocale } from './domain.js';
import { csEmailMessages } from './email-messages.js';
import { customerOnline } from './presence.js';

// 客服邮件 outbox（设计 §8.3、计划 §6.6）：沿用回执邮件的租约、退避与永久失败机制。
// 每个（会话，类型，收件人）至多一封待发邮件，期间的新消息合并进去；发送时记录覆盖到的 seq，下一封从这里继续。
export const CS_EMAIL_MAX_ATTEMPTS = 6;
const LEASE_SECONDS = 120;
const pending = 'sent_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL';

type Db = Pick<pg.Pool, 'query'>;

/** 客户留言后，为每个通知邮箱入队（坐席语言）；距上一封不足 10 分钟时顺延 */
export async function enqueueOfflineNotice(db: Db, conversationId: string, recipients: string[], locale: CsLocale): Promise<void> {
  if (recipients.length === 0) return;
  await db.query(`INSERT INTO cs_email_outbox(conversation_id,kind,recipient,locale,after_seq,due_at)
    SELECT $1,'offline_notice',r.recipient,$3,COALESCE(prev.covered_seq,0),GREATEST(now(),COALESCE(prev.sent_at + interval '10 minutes',now()))
    FROM unnest($2::text[]) AS r(recipient)
    LEFT JOIN LATERAL (SELECT covered_seq, sent_at FROM cs_email_outbox o WHERE o.conversation_id=$1 AND o.kind='offline_notice'
      AND o.recipient=r.recipient AND o.sent_at IS NOT NULL ORDER BY o.sent_at DESC LIMIT 1) prev ON true
    ON CONFLICT DO NOTHING`, [conversationId, recipients, locale]);
}

/**
 * 坐席发出 text 后：已开启回复邮件、有可用邮箱、客户不在线时，5 分钟后提醒客户；已有待发行时合并。
 * 收件人优先使用会话联系邮箱，登录用户没有时使用账户邮箱。
 */
export async function scheduleReplyNotice(db: Db, redis: Redis, conversationId: string): Promise<boolean> {
  const row = (await db.query<{ enabled: boolean; recipient: string | null; locale: CsLocale; readSeq: string }>(
    `SELECT s.reply_email_enabled AS enabled, lower(COALESCE(c.contact_email, u.email)) AS recipient, c.customer_locale AS locale, c.customer_read_seq AS "readSeq"
     FROM cs_conversations c CROSS JOIN cs_settings s LEFT JOIN users u ON u.id=c.customer_user_id WHERE c.id=$1`, [conversationId])).rows[0];
  if (!row?.enabled || !row.recipient || await customerOnline(redis, conversationId)) return false;
  const result = await db.query(`INSERT INTO cs_email_outbox(conversation_id,kind,recipient,locale,after_seq,due_at)
    SELECT $1,'reply_notice',$2,$3,GREATEST($4::bigint,COALESCE((SELECT covered_seq FROM cs_email_outbox o WHERE o.conversation_id=$1
      AND o.kind='reply_notice' AND o.sent_at IS NOT NULL ORDER BY o.sent_at DESC LIMIT 1),0)), now() + interval '5 minutes'
    WHERE NOT EXISTS (SELECT 1 FROM cs_email_outbox WHERE conversation_id=$1 AND kind='reply_notice' AND ${pending})
    ON CONFLICT DO NOTHING`, [conversationId, row.recipient, row.locale, row.readSeq]);
  return result.rowCount === 1;
}

/** 客户上线或已读时取消尚未投递的回复提醒；正在投递（租约内）的不受影响 */
export async function cancelReplyNotices(db: Db, conversationId: string): Promise<void> {
  await db.query(`UPDATE cs_email_outbox SET cancelled_at=now() WHERE conversation_id=$1 AND kind='reply_notice' AND ${pending}
    AND (locked_until IS NULL OR locked_until < now())`, [conversationId]);
}

export interface CsEmail {
  id: string; conversationId: string; kind: 'offline_notice' | 'reply_notice'; recipient: string; locale: CsLocale;
  afterSeq: string; attempts: number; conversationNo: string; deleted: boolean;
}

// 租约在单条语句内取得，调用 SMTP 时不持有行锁
export async function claimCsEmails(db: Db, limit = 10): Promise<CsEmail[]> {
  return (await db.query<CsEmail>(`UPDATE cs_email_outbox o SET attempts=o.attempts+1, locked_until=now() + make_interval(secs => $2)
    FROM (SELECT id FROM cs_email_outbox WHERE ${pending} AND due_at <= now() AND (locked_until IS NULL OR locked_until < now())
          ORDER BY due_at LIMIT $1 FOR UPDATE SKIP LOCKED) picked, cs_conversations c
    WHERE o.id=picked.id AND c.id=o.conversation_id
    RETURNING o.id, o.conversation_id AS "conversationId", o.kind, o.recipient, o.locale, o.after_seq AS "afterSeq", o.attempts,
      c.conversation_no AS "conversationNo", c.deleted_at IS NOT NULL AS deleted`, [limit, LEASE_SECONDS])).rows;
}

export interface EmailLine { seq: string; body: string; translation: string | null }
export interface EmailContent { lines: EmailLine[]; total: number; customer: string | null; visitor: boolean; contexts: string[]; contactEmail: string | null }

/** 邮件覆盖的消息：离线通知取客户留言（附坐席语言译文）；回复通知取最近 3 条坐席回复（附客户语言译文） */
export async function loadEmailContent(db: Db, email: CsEmail): Promise<EmailContent> {
  const offline = email.kind === 'offline_notice';
  const rows = (await db.query<EmailLine>(`SELECT m.seq, m.body, t.body AS translation FROM cs_messages m
      LEFT JOIN cs_message_translations t ON t.message_id=m.id AND t.target_locale=$3 AND t.status='done'
    WHERE m.conversation_id=$1 AND m.seq > $2 AND m.deleted_at IS NULL AND m.visibility='public'
      AND ${offline ? "m.kind='offline'" : "m.sender_type='agent' AND m.kind='text'"} ORDER BY m.seq`, [email.conversationId, email.afterSeq, email.locale])).rows;
  const info = (await db.query<{ username: string | null; visitor: boolean; contactEmail: string | null; contexts: string[] }>(
    `SELECT u.username, c.visitor_id IS NOT NULL AS visitor, c.contact_email AS "contactEmail",
       ARRAY(SELECT CASE WHEN x.kind='scheme' THEN x.ref || ' ' || (x.snapshot->>'name') ELSE x.snapshot->>'projectNo' END
             FROM cs_conversation_contexts x WHERE x.conversation_id=c.id ORDER BY x.created_at) AS contexts
     FROM cs_conversations c LEFT JOIN users u ON u.id=c.customer_user_id WHERE c.id=$1`, [email.conversationId])).rows[0];
  return { lines: offline ? rows : rows.slice(-3), total: rows.length, customer: info?.username ?? null, visitor: info?.visitor ?? true,
    contexts: info?.contexts ?? [], contactEmail: info?.contactEmail ?? null };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const fill = (template: string, params: Record<string, string | number>) => Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
const clip = (value: string, length: number) => (value.length > length ? `${value.slice(0, length)}…` : value);

/** 纯文本 + HTML；正文一律转义，链接不带任何凭据 */
export function renderCsEmail(email: CsEmail, content: EmailContent, clientPublicUrl: string) {
  const m = csEmailMessages[email.locale] ?? csEmailMessages.zh;
  const dir = email.locale === 'ar' ? 'rtl' : 'ltr';
  const shell = (body: string) => `<!doctype html><html lang="${email.locale}" dir="${dir}"><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">${body}`
    + `<p style="color:#9ca3af;font-size:12px">${escapeHtml(m.footer)}</p></body></html>`;
  const paragraph = (value: string) => `<p style="white-space:pre-wrap">${escapeHtml(value)}</p>`;
  if (email.kind === 'offline_notice') {
    const customer = content.visitor ? `${m.visitor} · ${content.contactEmail ?? ''}` : `${content.customer ?? ''}${content.contactEmail ? ` · ${content.contactEmail}` : ''}`;
    const rows: [string, string][] = [[m.conversationNo, email.conversationNo], [m.customer, customer],
      ...(content.contexts.length ? [[m.contexts, content.contexts.join('；')] as [string, string]] : [])];
    const lines = content.lines.map(line => ({ body: line.body, translation: line.translation }));
    const text = [m.offlineTitle, ...rows.map(([label, value]) => `${label}: ${value}`), '', `${m.messages}:`,
      ...lines.flatMap(line => [line.body, ...(line.translation ? [`${m.translation}: ${line.translation}`] : []), '']), m.offlineNote, '', m.footer].join('\n');
    const html = shell(`<h2 style="font-size:18px">${escapeHtml(m.offlineTitle)}</h2><table style="border-collapse:collapse">`
      + rows.map(([label, value]) => `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('')
      + `</table><h3 style="font-size:16px">${escapeHtml(m.messages)}</h3>`
      + lines.map(line => paragraph(line.body) + (line.translation ? `<p style="white-space:pre-wrap;color:#6b7280">${escapeHtml(`${m.translation}: ${line.translation}`)}</p>` : '')).join('')
      + paragraph(m.offlineNote));
    return { subject: fill(m.offlineSubject, { conversationNo: email.conversationNo }), text, html };
  }
  const link = `${clientPublicUrl}/?cs=open`;
  const replies = content.lines.map(line => clip(line.translation ?? line.body, 200));
  const more = content.total > replies.length ? fill(m.replyMore, { count: content.total - replies.length }) : null;
  const text = [m.replyTitle, '', m.replyIntro, ...replies.flatMap(reply => [reply, '']), ...(more ? [more, ''] : []), m.replyAction, link, '', m.footer].join('\n');
  const html = shell(`<h2 style="font-size:18px">${escapeHtml(m.replyTitle)}</h2>${paragraph(m.replyIntro)}`
    + replies.map(reply => `<blockquote style="margin:8px 0;padding:8px 12px;background:#f3f4f6;white-space:pre-wrap">${escapeHtml(reply)}</blockquote>`).join('')
    + (more ? paragraph(more) : '') + `<p>${escapeHtml(m.replyAction)}<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`);
  return { subject: fill(m.replySubject, { conversationNo: email.conversationNo }), text, html };
}

/**
 * 标记已发送并记录覆盖到的 seq。投递期间新到的消息不在本封邮件内，此时补一封待发邮件：
 * 离线通知距本封 10 分钟后发送，回复通知 5 分钟后发送（投递前仍会检查客户是否在线）。
 */
export async function completeCsEmail(db: Db, email: CsEmail, coveredSeq: string): Promise<void> {
  await db.query(`UPDATE cs_email_outbox SET sent_at=now(), covered_seq=$2, locked_until=NULL, last_error_code=NULL WHERE id=$1 AND sent_at IS NULL`, [email.id, coveredSeq]);
  const offline = email.kind === 'offline_notice';
  await db.query(`INSERT INTO cs_email_outbox(conversation_id,kind,recipient,locale,after_seq,due_at)
    SELECT $1,$2,$3,$4,$5,now() + make_interval(mins => $6)
    WHERE EXISTS (SELECT 1 FROM cs_messages m JOIN cs_conversations c ON c.id=m.conversation_id WHERE m.conversation_id=$1 AND m.seq > $5
      AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND ${offline ? "m.kind='offline'" : "m.sender_type='agent' AND m.kind='text' AND m.seq > c.customer_read_seq"})
    ON CONFLICT DO NOTHING`, [email.conversationId, email.kind, email.recipient, email.locale, coveredSeq, offline ? 10 : 5]);
}

export async function cancelCsEmail(db: Db, id: string): Promise<void> {
  await db.query('UPDATE cs_email_outbox SET cancelled_at=now(), locked_until=NULL WHERE id=$1 AND sent_at IS NULL', [id]);
}

export function csEmailBackoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 3600);
}

/** permanent：收件地址被拒等重试无意义的错误，直接进入终态。返回 true 表示已终态失败。 */
export async function failCsEmail(db: Db, email: Pick<CsEmail, 'id' | 'attempts'>, code: string, permanent: boolean): Promise<boolean> {
  const exhausted = permanent || email.attempts >= CS_EMAIL_MAX_ATTEMPTS;
  await db.query(`UPDATE cs_email_outbox SET locked_until=NULL, last_error_code=$2, due_at=now() + make_interval(secs => $3),
    failed_at=CASE WHEN $4::boolean THEN now() END WHERE id=$1 AND sent_at IS NULL`, [email.id, code.slice(0, 64), csEmailBackoffSeconds(email.attempts), exhausted]);
  return exhausted;
}
