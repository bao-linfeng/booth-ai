import type pg from 'pg';
import { errorCode, type Logger } from '../infra/logger.js';
import { WEBHOOK_MAX_SEND_MS, WebhookDeliveryError, type WebhookMessage } from '../infra/webhook.js';
import {
  claimProjectNotifications,
  completeProjectNotification,
  failProjectNotification,
  PROJECT_NOTIFICATION_LEASE_SECONDS,
  releaseProjectNotifications,
} from '../modules/projects/notifications.js';
import { processLeased } from './leased-batch.js';

export type ProjectNotificationSender = (message: WebhookMessage) => Promise<void>;

// An unreachable channel stops the batch and releases the rest instead of timing out on every event.
export async function deliverProjectNotifications(
  database: Pick<pg.Pool, 'query'>,
  send: ProjectNotificationSender,
  log: Logger,
  now: () => number = Date.now,
) {
  const startedAt = now();
  const claimed = await claimProjectNotifications(database);
  let delivered = 0;
  let failed = 0;
  const released = await processLeased(
    claimed,
    { startedAt, now, budget: { leaseMs: PROJECT_NOTIFICATION_LEASE_SECONDS * 1000, itemMs: WEBHOOK_MAX_SEND_MS } },
    async notification => {
      const context = { eventId: notification.eventId, projectId: notification.projectId, attempt: notification.attempts };
      try {
        const { id: _id, attempts: _attempts, ...body } = notification;
        await send({ id: notification.eventId, body });
      } catch (error) {
        failed++;
        const exhausted = await failProjectNotification(database, notification, errorCode(error));
        log[exhausted ? 'error' : 'warn']({ ...context, code: errorCode(error), exhausted }, 'Project notification delivery failed');
        return error instanceof WebhookDeliveryError && error.code === 'NOTIFICATION_UNAVAILABLE' ? 'halt' : 'next';
      }
      await completeProjectNotification(database, notification.id);
      delivered++;
      log.info(context, 'Project notification delivered');
      return 'next';
    },
    ids => releaseProjectNotifications(database, ids),
  );
  return { delivered, failed, released };
}
