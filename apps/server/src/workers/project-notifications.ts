import type pg from 'pg';
import { errorCode, type Logger } from '../infra/logger.js';
import type { WebhookMessage } from '../infra/webhook.js';
import { claimProjectNotifications, completeProjectNotification, failProjectNotification } from '../modules/projects/notifications.js';

export type ProjectNotificationSender = (message: WebhookMessage) => Promise<void>;

export async function deliverProjectNotifications(database: Pick<pg.Pool, 'query'>, send: ProjectNotificationSender, log: Logger) {
  const claimed = await claimProjectNotifications(database);
  let delivered = 0;
  let failed = 0;
  for (const notification of claimed) {
    const context = { eventId: notification.eventId, projectId: notification.projectId, attempt: notification.attempts };
    try {
      const { id: _id, attempts: _attempts, ...body } = notification;
      await send({ id: notification.eventId, body });
    } catch (error) {
      failed++;
      const exhausted = await failProjectNotification(database, notification, errorCode(error));
      log[exhausted ? 'error' : 'warn']({ ...context, code: errorCode(error), exhausted }, 'Project notification delivery failed');
      continue;
    }
    await completeProjectNotification(database, notification.id);
    delivered++;
    log.info(context, 'Project notification delivered');
  }
  return { delivered, failed };
}
