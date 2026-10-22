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
import { deliverLeased, mailFailure } from './leased-batch.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// 附件报价单与后台导出同一份内容。报价单生成失败属于数据问题，直接终态失败，错误码取其 reason。
export function deliverQuotationEmails(database: Pick<pg.Pool, 'query'>, send: MailSender, log: Logger, now: () => number = Date.now) {
  return deliverLeased(
    {
      name: 'Quotation email',
      leaseSeconds: QUOTATION_EMAIL_LEASE_SECONDS,
      itemMs: SMTP_MAX_SEND_MS,
      claim: () => claimQuotationEmails(database),
      release: ids => releaseQuotationEmails(database, ids),
      context: email => ({ quotationEmailId: email.id, projectId: email.projectId, attempt: email.attempts }),
      send: async email => {
        const workbook = await quotationWorkbook(email, email.quotation, email.locale);
        await send({
          to: email.recipient,
          ...renderQuotationEmail(email),
          attachments: [
            { filename: `${email.projectNo}-quotation-r${email.quotation.revision}.xlsx`, content: workbook, contentType: XLSX },
          ],
        });
      },
      classify: error => {
        const reason = (error as { reason?: unknown }).reason;
        return {
          ...mailFailure(error),
          code: typeof reason === 'string' ? reason : errorCode(error),
          permanent: !(error instanceof MailDeliveryError) || error.permanent,
        };
      },
      fail: (email, { code, permanent }) => failQuotationEmail(database, email, code, permanent),
      complete: email => completeQuotationEmail(database, email.id),
    },
    log,
    now,
  );
}
