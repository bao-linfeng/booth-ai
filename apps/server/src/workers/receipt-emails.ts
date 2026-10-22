import type pg from 'pg';
import type { Logger } from '../infra/logger.js';
import { SMTP_MAX_SEND_MS, type MailSender } from '../infra/mailer.js';
import {
  claimReceiptEmails,
  completeReceiptEmail,
  failReceiptEmail,
  RECEIPT_EMAIL_LEASE_SECONDS,
  releaseReceiptEmails,
  renderReceiptEmail,
} from '../modules/projects/receipt-emails.js';
import { deliverLeased, mailFailure } from './leased-batch.js';

export function deliverReceiptEmails(
  database: Pick<pg.Pool, 'query'>,
  send: MailSender,
  clientPublicUrl: string,
  log: Logger,
  now: () => number = Date.now,
) {
  return deliverLeased(
    {
      name: 'Receipt email',
      leaseSeconds: RECEIPT_EMAIL_LEASE_SECONDS,
      itemMs: SMTP_MAX_SEND_MS,
      claim: () => claimReceiptEmails(database),
      release: ids => releaseReceiptEmails(database, ids),
      context: email => ({ receiptEmailId: email.id, projectId: email.projectId, attempt: email.attempts }),
      send: email => send({ to: email.recipient, ...renderReceiptEmail(email, clientPublicUrl) }),
      classify: mailFailure,
      fail: (email, { code, permanent }) => failReceiptEmail(database, email, code, permanent),
      complete: email => completeReceiptEmail(database, email.id),
    },
    log,
    now,
  );
}
