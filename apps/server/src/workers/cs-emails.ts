import type pg from 'pg';
import type { Redis } from 'ioredis';
import { errorCode, type Logger } from '../infra/logger.js';
import { MailDeliveryError, type MailSender } from '../infra/mailer.js';
import { cancelCsEmail, claimCsEmails, completeCsEmail, deferCsEmail, failCsEmail, loadEmailContent, renderCsEmail } from '../modules/customer-service/emails.js';
import { customerOnline } from '../modules/customer-service/presence.js';

// 日志只记录会话与尝试次数，不输出收件人邮箱
export async function deliverCsEmails(database: Pick<pg.Pool, 'query'>, redis: Redis, send: MailSender, clientPublicUrl: string, log: Logger) {
  let delivered = 0;
  let failed = 0;
  for (const email of await claimCsEmails(database)) {
    const context = { csEmailId: email.id, conversationId: email.conversationId, kind: email.kind, attempt: email.attempts };
    if (email.deleted) {
      await cancelCsEmail(database, email.id);
      continue;
    }
    // 回复提醒以已读游标为准：没有未读回复就取消；有未读但客户仍在线（面板开着、页面可能在后台）时只顺延，超过最长顺延时间照发
    const content = await loadEmailContent(database, email);
    if (content.lines.length === 0) {
      await cancelCsEmail(database, email.id);
      continue;
    }
    if (email.kind === 'reply_notice' && email.deferrable && await customerOnline(redis, email.conversationId)) {
      await deferCsEmail(database, email.id);
      continue;
    }
    try {
      await send({ to: email.recipient, ...renderCsEmail(email, content, clientPublicUrl) });
    } catch (error) {
      failed++;
      const code = errorCode(error);
      const exhausted = await failCsEmail(database, email, code, error instanceof MailDeliveryError && error.permanent);
      log[exhausted ? 'error' : 'warn']({ ...context, code, exhausted }, 'Customer service email delivery failed');
      continue;
    }
    await completeCsEmail(database, email, content.lines.at(-1)!.seq);
    delivered++;
    log.info(context, 'Customer service email delivered');
  }
  return { delivered, failed };
}
