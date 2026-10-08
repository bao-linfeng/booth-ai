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

export async function settingsView(db: Pick<pg.Pool, 'query'>) {
  return { ...await getSettings(db), translationModelAssigned: (await assignedAiModels(db, 'cs_translation')).length > 0 };
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
