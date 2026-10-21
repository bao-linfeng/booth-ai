import type pg from 'pg';
import { errorCode, type Logger } from '../infra/logger.js';
import { MailDeliveryError, SMTP_MAX_SEND_MS, type MailSender } from '../infra/mailer.js';
import {
  claimQuotationEmails,
  completeQuotationEmail,
  failQuotationEmail,
  QUOTATION_EMAIL_LEASE_SECONDS,
  releaseQuotationEmails,
  renderQuotationEmail,
} from '../modules/projects/quotation-emails.js';
import { quotationWorkbook } from '../modules/projects/quotation-workbook.js';
import { processLeased } from './leased-batch.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// 附件报价单与后台导出同一份内容。日志只记录项目与尝试次数，不输出收件人邮箱。
// SMTP 临时故障（非 5xx 拒收）时停止本批并释放剩余邮件；报价单生成失败属于数据问题，直接终态失败。
export async function deliverQuotationEmails(
  database: Pick<pg.Pool, 'query'>,
  send: MailSender,
  log: Logger,
  now: () => number = Date.now,
) {
  const startedAt = now();
  const claimed = await claimQuotationEmails(database);
  let delivered = 0;
  let failed = 0;
  const released = await processLeased(
    claimed,
    { startedAt, now, budget: { leaseMs: QUOTATION_EMAIL_LEASE_SECONDS * 1000, itemMs: SMTP_MAX_SEND_MS } },
    async email => {
      const context = { quotationEmailId: email.id, projectId: email.projectId, attempt: email.attempts };
      try {
        const workbook = await quotationWorkbook(email, email.quotation, email.locale);
        await send({
          to: email.recipient,
          ...renderQuotationEmail(email),
          attachments: [
            { filename: `${email.projectNo}-quotation-r${email.quotation.revision}.xlsx`, content: workbook, contentType: XLSX },
          ],
        });
      } catch (error) {
        failed++;
        const reason = (error as { reason?: unknown }).reason;
        const code = typeof reason === 'string' ? reason : errorCode(error);
        const permanent = !(error instanceof MailDeliveryError) || error.permanent;
        const exhausted = await failQuotationEmail(database, email, code, permanent);
        log[exhausted ? 'error' : 'warn']({ ...context, code, exhausted }, 'Quotation email delivery failed');
        return error instanceof MailDeliveryError && !permanent ? 'halt' : 'next';
      }
      await completeQuotationEmail(database, email.id);
      delivered++;
      log.info(context, 'Quotation email delivered');
      return 'next';
    },
    ids => releaseQuotationEmails(database, ids),
  );
  return { delivered, failed, released };
}
