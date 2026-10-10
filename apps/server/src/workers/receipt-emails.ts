import type pg from 'pg';
import { errorCode, type Logger } from '../infra/logger.js';
import { MailDeliveryError, SMTP_MAX_SEND_MS, type MailSender } from '../infra/mailer.js';
import { claimReceiptEmails, completeReceiptEmail, failReceiptEmail, RECEIPT_EMAIL_LEASE_SECONDS, releaseReceiptEmails, renderReceiptEmail } from '../modules/projects/receipt-emails.js';
import { processLeased } from './leased-batch.js';

// 日志只记录项目与尝试次数，不输出收件人邮箱。
// SMTP 临时故障（非 5xx 拒收）时停止本批并释放剩余邮件，避免不可达的服务器让每封都等满超时。
export async function deliverReceiptEmails(database: Pick<pg.Pool, 'query'>, send: MailSender, clientPublicUrl: string, log: Logger, now: () => number = Date.now) {
  const startedAt = now();
  const claimed = await claimReceiptEmails(database);
  let delivered = 0;
  let failed = 0;
  const released = await processLeased(claimed, { startedAt, now, budget: { leaseMs: RECEIPT_EMAIL_LEASE_SECONDS * 1000, itemMs: SMTP_MAX_SEND_MS } }, async email => {
    const context = { receiptEmailId: email.id, projectId: email.projectId, attempt: email.attempts };
    try {
      await send({ to: email.recipient, ...renderReceiptEmail(email, clientPublicUrl) });
    } catch (error) {
      failed++;
      const code = errorCode(error);
      const permanent = error instanceof MailDeliveryError && error.permanent;
      const exhausted = await failReceiptEmail(database, email, code, permanent);
      log[exhausted ? 'error' : 'warn']({ ...context, code, exhausted }, 'Receipt email delivery failed');
      return error instanceof MailDeliveryError && !permanent ? 'halt' : 'next';
    }
    await completeReceiptEmail(database, email.id);
    delivered++;
    log.info(context, 'Receipt email delivered');
    return 'next';
  }, ids => releaseReceiptEmails(database, ids));
  return { delivered, failed, released };
}
