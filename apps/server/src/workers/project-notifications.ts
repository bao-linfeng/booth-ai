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
import { deliverLeased } from './leased-batch.js';

export type ProjectNotificationSender = (message: WebhookMessage) => Promise<void>;

// An unreachable channel stops the batch and releases the rest instead of timing out on every event.
export function deliverProjectNotifications(
  database: Pick<pg.Pool, 'query'>,
  send: ProjectNotificationSender,
  log: Logger,
  now: () => number = Date.now,
) {
  return deliverLeased(
    {
      name: 'Project notification',
      leaseSeconds: PROJECT_NOTIFICATION_LEASE_SECONDS,
      itemMs: WEBHOOK_MAX_SEND_MS,
      claim: () => claimProjectNotifications(database),
      release: ids => releaseProjectNotifications(database, ids),
      context: notification => ({ eventId: notification.eventId, projectId: notification.projectId, attempt: notification.attempts }),
      send: notification => {
        const { id: _id, attempts: _attempts, ...body } = notification;
        return send({ id: notification.eventId, body });
      },
      classify: error => ({
        code: errorCode(error),
        permanent: false,
        halt: error instanceof WebhookDeliveryError && error.code === 'NOTIFICATION_UNAVAILABLE',
      }),
      fail: (notification, { code }) => failProjectNotification(database, notification, code),
      complete: notification => completeProjectNotification(database, notification.id),
    },
    log,
    now,
  );
}
