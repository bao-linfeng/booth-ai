import type pg from 'pg';
import type { MessageLocale } from '../selection/messages/index.js';
import { receiptEmailMessages } from './receipt-email-messages.js';

// 回执邮件是受理的副作用：发信失败不影响项目受理，Worker 崩溃于发送后、完成前时可能重复发送。
export const RECEIPT_EMAIL_MAX_ATTEMPTS = 6;
// 同一收件人 24 小时内最多入队的回执数，超出后静默跳过，防止匿名提交被用来批量骚扰任意邮箱
export const RECEIPT_EMAIL_DAILY_LIMIT_PER_RECIPIENT = 5;
const LEASE_SECONDS = 120;

export interface ReceiptEmailInput { projectId: string; recipient: string; locale: MessageLocale; accountBound: boolean }

export async function enqueueReceiptEmail(client: pg.PoolClient, input: ReceiptEmailInput): Promise<boolean> {
  const result = await client.query(`INSERT INTO project_receipt_emails(project_id,recipient,locale,account_bound)
    SELECT $1,$2,$3,$4 WHERE (SELECT count(*) FROM project_receipt_emails
      WHERE lower(recipient)=lower($2) AND created_at > now() - interval '24 hours') < $5`,
  [input.projectId, input.recipient, input.locale, input.accountBound, RECEIPT_EMAIL_DAILY_LIMIT_PER_RECIPIENT]);
  return result.rowCount === 1;
}

export interface ReceiptEmail {
  id: string; projectId: string; recipient: string; locale: MessageLocale; accountBound: boolean; attempts: number;
  projectNo: string; requestNo: string; sourceType: 'quote_request' | 'manual_request'; contactName: string;
  exhibition: { name: string; city: string; startDate: string; endDate: string } | null; schemeName: string | null; schemeCode: string | null;
}

// 租约在单条语句内取得，调用 SMTP 时不持有行锁
export async function claimReceiptEmails(database: Pick<pg.Pool, 'query'>, limit = 10): Promise<ReceiptEmail[]> {
  return (await database.query<ReceiptEmail>(
    `UPDATE project_receipt_emails r SET attempts = r.attempts + 1, locked_until = now() + make_interval(secs => $2)
     FROM (SELECT id FROM project_receipt_emails
           WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
           ORDER BY next_attempt_at, created_at LIMIT $1 FOR UPDATE SKIP LOCKED) c, projects p
     WHERE r.id = c.id AND p.id = r.project_id
     RETURNING r.id, r.project_id AS "projectId", r.recipient, r.locale, r.account_bound AS "accountBound", r.attempts,
       p.project_no AS "projectNo", p.request_no AS "requestNo", p.source_type AS "sourceType",
       p.request_snapshot->'contact'->>'name' AS "contactName", p.request_snapshot->'exhibition' AS exhibition,
       p.scheme_snapshot->>'name' AS "schemeName", p.scheme_code AS "schemeCode"`, [limit, LEASE_SECONDS])).rows;
}

export async function completeReceiptEmail(database: Pick<pg.Pool, 'query'>, id: string): Promise<void> {
  await database.query(`UPDATE project_receipt_emails SET delivered_at = now(), locked_until = NULL, last_error_code = NULL
    WHERE id = $1 AND delivered_at IS NULL`, [id]);
}

export function receiptEmailBackoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 3600);
}

// permanent：收件地址被拒等重试无意义的错误，直接进入终态。返回 true 表示已终态失败。
export async function failReceiptEmail(database: Pick<pg.Pool, 'query'>, email: Pick<ReceiptEmail, 'id' | 'attempts'>, code: string, permanent: boolean): Promise<boolean> {
  const exhausted = permanent || email.attempts >= RECEIPT_EMAIL_MAX_ATTEMPTS;
  await database.query(`UPDATE project_receipt_emails SET locked_until = NULL, last_error_code = $2,
    next_attempt_at = now() + make_interval(secs => $3), failed_at = CASE WHEN $4::boolean THEN now() END
    WHERE id = $1 AND delivered_at IS NULL`, [email.id, code.slice(0, 64), receiptEmailBackoffSeconds(email.attempts), exhausted]);
  return exhausted;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const fill = (template: string, params: Record<string, string>) => Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), template);

export function renderReceiptEmail(email: ReceiptEmail, clientPublicUrl: string) {
  const m = receiptEmailMessages[email.locale] ?? receiptEmailMessages.zh;
  const link = email.accountBound ? `${clientPublicUrl}/my-projects/${encodeURIComponent(email.projectId)}`
    : `${clientPublicUrl}/auth/sign-in?redirect=${encodeURIComponent('/my-projects')}`;
  const rows: [string, string][] = [
    [m.typeLabel, email.sourceType === 'quote_request' ? m.typeQuote : m.typeManual],
    [m.projectNo, email.projectNo],
    [m.requestNo, email.requestNo],
    ...(email.exhibition ? [[m.exhibition, `${email.exhibition.name} · ${email.exhibition.city} · ${email.exhibition.startDate} ~ ${email.exhibition.endDate}`] as [string, string]] : []),
    ...(email.schemeCode ? [[m.scheme, email.schemeName ? `${email.schemeName} (${email.schemeCode})` : email.schemeCode] as [string, string]] : []),
  ];
  const greeting = fill(m.greeting, { name: email.contactName || email.recipient });
  const view = email.accountBound ? m.viewAccount : fill(m.viewGuest, { email: email.recipient });
  const text = [greeting, '', m.title, ...rows.map(([label, value]) => `${label}: ${value}`), '', m.note, '', view, link, '', m.footer].join('\n');
  const dir = email.locale === 'ar' ? 'rtl' : 'ltr';
  const html = `<!doctype html><html lang="${email.locale}" dir="${dir}"><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">`
    + `<p>${escapeHtml(greeting)}</p><h2 style="font-size:18px">${escapeHtml(m.title)}</h2>`
    + `<table style="border-collapse:collapse">${rows.map(([label, value]) => `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`).join('')}</table>`
    + `<p>${escapeHtml(m.note)}</p><p>${escapeHtml(view)}<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`
    + `<p style="color:#9ca3af;font-size:12px">${escapeHtml(m.footer)}</p></body></html>`;
  return { subject: `${m.title} · ${email.projectNo}`, text, html };
}
