import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Logger } from '../infra/logger.js';
import { SMTP_MAX_SEND_MS, type MailSender } from '../infra/mailer.js';
import {
  cancelCsEmail,
  claimCsEmails,
  completeCsEmail,
  CS_EMAIL_LEASE_SECONDS,
  deferCsEmail,
  failCsEmail,
  loadEmailContent,
  releaseCsEmails,
  renderCsEmail,
} from '../modules/customer-service/emails.js';
import { customerOnline } from '../modules/customer-service/presence.js';
import { deliverLeased, mailFailure, skip } from './leased-batch.js';

export function deliverCsEmails(
  database: Pick<pg.Pool, 'query'>,
  redis: Redis,
  send: MailSender,
  clientPublicUrl: string,
  log: Logger,
  now: () => number = Date.now,
) {
  return deliverLeased(
    {
      name: 'Customer service email',
      leaseSeconds: CS_EMAIL_LEASE_SECONDS,
      itemMs: SMTP_MAX_SEND_MS,
      claim: () => claimCsEmails(database),
      release: ids => releaseCsEmails(database, ids),
      context: email => ({ csEmailId: email.id, conversationId: email.conversationId, kind: email.kind, attempt: email.attempts }),
      // 回复提醒以已读游标为准：没有未读回复就取消；有未读但客户仍在线（面板开着、页面可能在后台）时只顺延，超过最长顺延时间照发
      prepare: async email => {
        if (email.deleted) {
          await cancelCsEmail(database, email.id);
          return skip;
        }
        const content = await loadEmailContent(database, email);
        if (content.lines.length === 0) {
          await cancelCsEmail(database, email.id);
          return skip;
        }
        if (email.kind === 'reply_notice' && email.deferrable && (await customerOnline(redis, email.conversationId))) {
          await deferCsEmail(database, email.id);
          return skip;
        }
        return content;
      },
      send: (email, content) => send({ to: email.recipient, ...renderCsEmail(email, content, clientPublicUrl) }),
      classify: mailFailure,
      fail: (email, { code, permanent }) => failCsEmail(database, email, code, permanent),
      complete: (email, content) => completeCsEmail(database, email, content.lines.at(-1)!.seq),
    },
    log,
    now,
  );
}
