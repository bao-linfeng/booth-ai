import type pg from 'pg';
import { assignedAiModels } from '../../infra/ai/config.js';
import { writeAuditLog } from '../../infra/audit.js';
import { transaction } from '../../infra/database.js';
import { csError, normalizeEmail, type CsLocale } from './domain.js';

export interface CsSettings {
  translationEnabled: boolean; agentLocale: CsLocale; offlineNotifyEmails: string[]; replyEmailEnabled: boolean; revision: number; updatedAt: string;
}
export interface CsSettingsInput { translationEnabled: boolean; agentLocale: CsLocale; offlineNotifyEmails: string[]; replyEmailEnabled: boolean; expectedRevision: number }

const columns = `translation_enabled AS "translationEnabled", agent_locale AS "agentLocale", offline_notify_emails AS "offlineNotifyEmails",
  reply_email_enabled AS "replyEmailEnabled", revision, updated_at AS "updatedAt"`;
type Row = Omit<CsSettings, 'updatedAt'> & { updatedAt: Date };
const toSettings = (row: Row): CsSettings => ({ ...row, updatedAt: row.updatedAt.toISOString() });

export async function getSettings(db: Pick<pg.Pool, 'query'>): Promise<CsSettings> {
  const row = (await db.query<Row>(`SELECT ${columns} FROM cs_settings WHERE id`)).rows[0];
  if (!row) throw new Error('Customer service settings missing');
  return toSettings(row);
}

/**
 * 离线通知邮箱的投递状态（计划 R5）：failed 为最近一次永久失败晚于最近一次送达；retrying 为待发邮件已失败过、正在退避重试；
 * pending 为从未送达且有待发邮件（如未配置 SMTP）；idle 为尚无邮件。lastErrorCode 只在 failed / retrying 时给出。
 */
export type CsEmailDeliveryStatus = 'idle' | 'pending' | 'retrying' | 'sent' | 'failed';
export interface CsEmailDelivery {
  recipient: string; status: CsEmailDeliveryStatus; lastSentAt: string | null; lastFailedAt: string | null; lastErrorCode: string | null; pendingCount: number;
}

export async function offlineNotifyDelivery(db: Pick<pg.Pool, 'query'>, recipients: string[]): Promise<CsEmailDelivery[]> {
  if (recipients.length === 0) return [];
  const rows = (await db.query<{ recipient: string; lastSentAt: Date | null; lastFailedAt: Date | null; failedCode: string | null; pendingCount: number; retryCode: string | null }>(
    `SELECT r.recipient, s.last_sent AS "lastSentAt", f.failed_at AS "lastFailedAt", f.last_error_code AS "failedCode",
       p.count AS "pendingCount", p.code AS "retryCode"
     FROM unnest($1::text[]) WITH ORDINALITY AS r(recipient, ord)
     LEFT JOIN LATERAL (SELECT max(o.sent_at) AS last_sent FROM cs_email_outbox o WHERE o.kind='offline_notice' AND o.recipient=r.recipient) s ON true
     LEFT JOIN LATERAL (SELECT o.failed_at, o.last_error_code FROM cs_email_outbox o WHERE o.kind='offline_notice' AND o.recipient=r.recipient
       AND o.failed_at IS NOT NULL ORDER BY o.failed_at DESC LIMIT 1) f ON true
     LEFT JOIN LATERAL (SELECT count(*)::int AS count, (array_agg(o.last_error_code ORDER BY o.due_at) FILTER (WHERE o.last_error_code IS NOT NULL))[1] AS code
       FROM cs_email_outbox o WHERE o.kind='offline_notice' AND o.recipient=r.recipient AND o.sent_at IS NULL AND o.cancelled_at IS NULL AND o.failed_at IS NULL) p ON true
     ORDER BY r.ord`, [recipients])).rows;
  return rows.map(row => {
    const failed = row.lastFailedAt !== null && (row.lastSentAt === null || row.lastFailedAt > row.lastSentAt);
    const status: CsEmailDeliveryStatus = failed ? 'failed' : row.retryCode ? 'retrying' : row.lastSentAt ? 'sent' : row.pendingCount > 0 ? 'pending' : 'idle';
    return { recipient: row.recipient, status, lastSentAt: row.lastSentAt?.toISOString() ?? null, lastFailedAt: row.lastFailedAt?.toISOString() ?? null,
      lastErrorCode: failed ? row.failedCode : status === 'retrying' ? row.retryCode : null, pendingCount: row.pendingCount };
  });
}

export async function settingsView(db: Pick<pg.Pool, 'query'>) {
  const settings = await getSettings(db);
  return { ...settings, translationModelAssigned: (await assignedAiModels(db, 'cs_translation')).length > 0,
    offlineNotifyDelivery: await offlineNotifyDelivery(db, settings.offlineNotifyEmails) };
}

export async function updateSettings(pool: pg.Pool, input: CsSettingsInput, adminId: string) {
  const emails = [...new Set(input.offlineNotifyEmails.map(email => normalizeEmail(email)).filter((email): email is string => email !== null))];
  if (emails.length > 20) throw csError('TOO_MANY_EMAILS', 400);
  await transaction(pool, async client => {
    const before = (await client.query<Row>(`SELECT ${columns} FROM cs_settings WHERE id FOR UPDATE`)).rows[0]!;
    if (before.revision !== input.expectedRevision) throw csError('REVISION_CONFLICT', 409);
    const after = (await client.query<Row>(`UPDATE cs_settings SET translation_enabled=$1, agent_locale=$2, offline_notify_emails=$3,
      reply_email_enabled=$4, revision=revision+1, updated_by=$5, updated_at=now() WHERE id RETURNING ${columns}`,
    [input.translationEnabled, input.agentLocale, emails, input.replyEmailEnabled, adminId])).rows[0]!;
    const plain = ({ revision: _revision, updatedAt: _updatedAt, ...rest }: Row) => rest;
    await writeAuditLog(client, { adminId, action: 'cs_settings.update', targetType: 'cs_settings', targetId: 'default',
      detail: { before: plain(before), after: plain(after) } });
  });
  return settingsView(pool);
}
