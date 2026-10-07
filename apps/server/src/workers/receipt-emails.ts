import type pg from 'pg';
import { errorCode, type Logger } from '../infra/logger.js';
import { MailDeliveryError, type MailSender } from '../infra/mailer.js';
import { claimReceiptEmails, completeReceiptEmail, failReceiptEmail, renderReceiptEmail } from '../modules/projects/receipt-emails.js';

// 日志只记录项目与尝试次数，不输出收件人邮箱
export async function deliverReceiptEmails(database: Pick<pg.Pool, 'query'>, send: MailSender, clientPublicUrl: string, log: Logger) {
  const claimed = await claimReceiptEmails(database);
  let delivered = 0;
  let failed = 0;
  for (const email of claimed) {
    const context = { receiptEmailId: email.id, projectId: email.projectId, attempt: email.attempts };
    try {
      await send({ to: email.recipient, ...renderReceiptEmail(email, clientPublicUrl) });
    } catch (error) {
      failed++;
      const code = errorCode(error);
      const exhausted = await failReceiptEmail(database, email, code, error instanceof MailDeliveryError && error.permanent);
      log[exhausted ? 'error' : 'warn']({ ...context, code, exhausted }, 'Receipt email delivery failed');
      continue;
    }
    await completeReceiptEmail(database, email.id);
    delivered++;
    log.info(context, 'Receipt email delivered');
  }
  return { delivered, failed };
}
