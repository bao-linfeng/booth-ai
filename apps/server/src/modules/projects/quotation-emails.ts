import type pg from 'pg';
import { DEFAULT_MESSAGE_LOCALE, type MessageLocale } from '../selection/messages/index.js';
import { quotationEmailMessages } from './quotation-email-messages.js';
import type { SavedQuotation } from './quotation.js';
import { quotationWorkbookMessages } from './quotation-workbook-messages.js';
import { escapeHtml, fill, receiptEmailBackoffSeconds } from './receipt-emails.js';

// 报价邮件是保存报价时的发送动作：入队即视为已报价，投递结果写入项目时间线；Worker 崩溃于发送后、完成前时可能重复发送。
export const QUOTATION_EMAIL_MAX_ATTEMPTS = 6;
export const QUOTATION_EMAIL_LEASE_SECONDS = 120;

/** 语言沿用受理回执（提交时的界面语言），没有回执的项目用默认语言 */
export async function enqueueQuotationEmail(
  client: pg.PoolClient,
  input: { projectId: string; quotationRevision: number; recipient: string; requestedBy: string },
): Promise<void> {
  await client.query(
    `INSERT INTO project_quotation_emails(project_id,quotation_revision,recipient,locale,requested_by)
    VALUES($1,$2,$3,COALESCE((SELECT locale FROM project_receipt_emails WHERE project_id=$1),$5),$4)`,
    [input.projectId, input.quotationRevision, input.recipient, input.requestedBy, DEFAULT_MESSAGE_LOCALE],
  );
}

export interface QuotationEmail {
  id: string;
  projectId: string;
  recipient: string;
  locale: MessageLocale;
  attempts: number;
  projectNo: string;
  schemeCode: string | null;
  contact: { name: string; email?: string; phone?: string };
  company?: string;
  quotation: SavedQuotation;
}

// 租约在单条语句内取得，调用 SMTP 时不持有行锁
export async function claimQuotationEmails(database: Pick<pg.Pool, 'query'>, limit = 10): Promise<QuotationEmail[]> {
  return (
    await database.query<QuotationEmail>(
      `UPDATE project_quotation_emails e SET attempts = e.attempts + 1, locked_until = now() + make_interval(secs => $2)
     FROM (SELECT id FROM project_quotation_emails
           WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
           ORDER BY next_attempt_at, created_at LIMIT $1 FOR UPDATE SKIP LOCKED) c, projects p, project_quotation_revisions q
     WHERE e.id = c.id AND p.id = e.project_id AND q.project_id = e.project_id AND q.revision = e.quotation_revision
     RETURNING e.id, e.project_id AS "projectId", e.recipient, e.locale, e.attempts,
       p.project_no AS "projectNo", p.scheme_code AS "schemeCode",
       p.request_snapshot->'contact' AS contact, p.request_snapshot->>'company' AS company, q.snapshot AS quotation`,
      [limit, QUOTATION_EMAIL_LEASE_SECONDS],
    )
  ).rows.map(row => (row.company === null ? { ...row, company: undefined } : row));
}

// 送达与终态失败都在同一条语句里写入时间线事件（系统事件，无操作人）
const recordEvent = (status: 'delivered' | 'failed') => `INSERT INTO project_events(project_id,kind,payload,created_at)
    SELECT project_id,'quotation-email',
      jsonb_build_object('status','${status}','quotationRevision',quotation_revision,'recipient',recipient,'errorCode',last_error_code),
      clock_timestamp() FROM done`;

export async function completeQuotationEmail(database: Pick<pg.Pool, 'query'>, id: string): Promise<void> {
  await database.query(
    `WITH done AS (UPDATE project_quotation_emails SET delivered_at = now(), locked_until = NULL, last_error_code = NULL
      WHERE id = $1 AND delivered_at IS NULL RETURNING project_id, quotation_revision, recipient, last_error_code)
    ${recordEvent('delivered')}`,
    [id],
  );
}

// 本批来不及处理的已领取邮件：释放租约并退回本次计入的尝试次数
export async function releaseQuotationEmails(database: Pick<pg.Pool, 'query'>, ids: string[]): Promise<void> {
  await database.query(
    `UPDATE project_quotation_emails SET locked_until = NULL, attempts = GREATEST(attempts - 1, 0)
    WHERE id = ANY($1::uuid[]) AND delivered_at IS NULL AND failed_at IS NULL`,
    [ids],
  );
}

// permanent：收件地址被拒等重试无意义的错误，直接进入终态。返回 true 表示已终态失败。
export async function failQuotationEmail(
  database: Pick<pg.Pool, 'query'>,
  email: Pick<QuotationEmail, 'id' | 'attempts'>,
  code: string,
  permanent: boolean,
): Promise<boolean> {
  const exhausted = permanent || email.attempts >= QUOTATION_EMAIL_MAX_ATTEMPTS;
  await database.query(
    `WITH done AS (UPDATE project_quotation_emails SET locked_until = NULL, last_error_code = $2,
      next_attempt_at = now() + make_interval(secs => $3), failed_at = CASE WHEN $4::boolean THEN now() END
      WHERE id = $1 AND delivered_at IS NULL RETURNING project_id, quotation_revision, recipient, last_error_code, failed_at)
    ${recordEvent('failed')} WHERE failed_at IS NOT NULL`,
    [email.id, code.slice(0, 64), receiptEmailBackoffSeconds(email.attempts), exhausted],
  );
  return exhausted;
}

export function renderQuotationEmail(email: QuotationEmail) {
  const m = quotationEmailMessages[email.locale] ?? quotationEmailMessages[DEFAULT_MESSAGE_LOCALE];
  const quotation = email.quotation;
  const basis = (quotationWorkbookMessages[email.locale] ?? quotationWorkbookMessages[DEFAULT_MESSAGE_LOCALE]).priceBases[
    quotation.priceBasis
  ];
  const rows: [string, string][] = [
    [m.quotationNo, `${quotation.quotationNo} (r${quotation.revision})`],
    [m.projectNo, email.projectNo],
    [m.total, `${quotation.currency} ${quotation.totalAmount ?? ''}`],
    [m.priceBasis, basis],
    [m.validUntil, `${quotation.validUntil} (${quotation.validityTimeZone})`],
  ];
  // 客户可见的范围与条款为选填，空的不展示
  const sections = (
    [
      [m.inclusions, quotation.inclusions],
      [m.exclusions, quotation.exclusions],
      [m.terms, quotation.terms],
    ] as [string, string][]
  ).filter(([, value]) => value.trim());
  const greeting = fill(m.greeting, { name: email.contact.name || email.recipient });
  const text = [
    greeting,
    '',
    m.intro,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...sections.flatMap(([label, value]) => ['', `${label}:`, value]),
    '',
    m.note,
    '',
    m.footer,
  ].join('\n');
  const dir = email.locale === 'ar' ? 'rtl' : 'ltr';
  const html =
    `<!doctype html><html lang="${email.locale}" dir="${dir}"><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">` +
    `<p>${escapeHtml(greeting)}</p><h2 style="font-size:18px">${escapeHtml(m.title)}</h2><p>${escapeHtml(m.intro)}</p>` +
    `<table style="border-collapse:collapse">${rows.map(([label, value]) => `<tr><td style="padding:4px 16px 4px 0;color:#6b7280">${escapeHtml(label)}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`).join('')}</table>` +
    sections
      .map(
        ([label, value]) =>
          `<h3 style="font-size:14px;margin:16px 0 4px">${escapeHtml(label)}</h3><p style="white-space:pre-wrap;margin:0">${escapeHtml(value)}</p>`,
      )
      .join('') +
    `<p>${escapeHtml(m.note)}</p><p style="color:#9ca3af;font-size:12px">${escapeHtml(m.footer)}</p></body></html>`;
  return { subject: `${m.title} · ${quotation.quotationNo} r${quotation.revision}`, text, html };
}
