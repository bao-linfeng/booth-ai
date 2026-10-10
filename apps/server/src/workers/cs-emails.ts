import type pg from 'pg';
import type { Redis } from 'ioredis';
import { errorCode, type Logger } from '../infra/logger.js';
import { MailDeliveryError, SMTP_MAX_SEND_MS, type MailSender } from '../infra/mailer.js';
import { cancelCsEmail, claimCsEmails, completeCsEmail, CS_EMAIL_LEASE_SECONDS, deferCsEmail, failCsEmail, loadEmailContent, releaseCsEmails, renderCsEmail } from '../modules/customer-service/emails.js';
import { customerOnline } from '../modules/customer-service/presence.js';
import { processLeased } from './leased-batch.js';

// 日志只记录会话与尝试次数，不输出收件人邮箱。
// SMTP 临时故障（非 5xx 拒收）时停止本批并释放剩余邮件，避免不可达的服务器让每封都等满超时。
export async function deliverCsEmails(database: Pick<pg.Pool, 'query'>, redis: Redis, send: MailSender, clientPublicUrl: string, log: Logger, now: () => number = Date.now) {
  const startedAt = now();
  const claimed = await claimCsEmails(database);
  let delivered = 0;
  let failed = 0;
  const released = await processLeased(claimed, { startedAt, now, budget: { leaseMs: CS_EMAIL_LEASE_SECONDS * 1000, itemMs: SMTP_MAX_SEND_MS } }, async email => {
    const context = { csEmailId: email.id, conversationId: email.conversationId, kind: email.kind, attempt: email.attempts };
    if (email.deleted) {
      await cancelCsEmail(database, email.id);
      return 'next';
    }
    // 回复提醒以已读游标为准：没有未读回复就取消；有未读但客户仍在线（面板开着、页面可能在后台）时只顺延，超过最长顺延时间照发
    const content = await loadEmailContent(database, email);
    if (content.lines.length === 0) {
      await cancelCsEmail(database, email.id);
      return 'next';
    }
    if (email.kind === 'reply_notice' && email.deferrable && await customerOnline(redis, email.conversationId)) {
      await deferCsEmail(database, email.id);
      return 'next';
    }
    try {
      await send({ to: email.recipient, ...renderCsEmail(email, content, clientPublicUrl) });
    } catch (error) {
      failed++;
      const code = errorCode(error);
      const permanent = error instanceof MailDeliveryError && error.permanent;
      const exhausted = await failCsEmail(database, email, code, permanent);
      log[exhausted ? 'error' : 'warn']({ ...context, code, exhausted }, 'Customer service email delivery failed');
      return error instanceof MailDeliveryError && !permanent ? 'halt' : 'next';
    }
    await completeCsEmail(database, email, content.lines.at(-1)!.seq);
    delivered++;
    log.info(context, 'Customer service email delivered');
    return 'next';
  }, ids => releaseCsEmails(database, ids));
  return { delivered, failed, released };
}
