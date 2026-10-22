import type pg from 'pg';
import { leasedOutbox } from '../../infra/leased-outbox.js';

// Notification delivery is a side effect: it never decides whether a project was accepted.
// Consumers must de-duplicate on eventId because a crash after delivery and before completion re-sends the event.
export const PROJECT_NOTIFICATION_MAX_ATTEMPTS = 8;
export const PROJECT_NOTIFICATION_LEASE_SECONDS = 60;

export interface ProjectNotification {
  id: string;
  eventId: string;
  projectId: string;
  projectNo: string;
  sourceType: string;
  kind: string;
  payload: unknown;
  occurredAt: string;
  attempts: number;
  /** 可见范围：all 全员；assigners 有分配权限的人；recipient 仅 recipientAdminId。外部渠道可据此路由 */
  audience: 'all' | 'assigners' | 'recipient';
  recipientAdminId: string | null;
}

const outbox = leasedOutbox({
  table: 'project_notification_outbox',
  maxAttempts: PROJECT_NOTIFICATION_MAX_ATTEMPTS,
  backoff: { baseSeconds: 30, maxSeconds: 3600 },
});

export const projectNotificationBackoffSeconds = outbox.backoffSeconds;

export async function claimProjectNotifications(database: Pick<pg.Pool, 'query'>, limit = 10): Promise<ProjectNotification[]> {
  const { rows } = await database.query<Omit<ProjectNotification, 'occurredAt'> & { occurredAt: Date }>(
    `${outbox.claim('o')}, project_events e, projects p
     WHERE o.id = claimed.id AND e.id = o.event_id AND p.id = o.project_id
     RETURNING o.id, o.event_id AS "eventId", o.project_id AS "projectId", p.project_no AS "projectNo", p.source_type AS "sourceType",
       e.kind, e.payload, e.created_at AS "occurredAt", o.attempts, o.audience, o.recipient_admin_id AS "recipientAdminId"`,
    [limit, PROJECT_NOTIFICATION_LEASE_SECONDS],
  );
  return rows.map(row => ({ ...row, occurredAt: new Date(row.occurredAt).toISOString() }));
}

export const completeProjectNotification = (database: Pick<pg.Pool, 'query'>, id: string) => outbox.complete(database, id);
export const releaseProjectNotifications = (database: Pick<pg.Pool, 'query'>, ids: string[]) => outbox.release(database, ids);

// Webhook failures carry no permanent flag: every event uses its full attempt budget before needing manual follow-up.
export const failProjectNotification = (
  database: Pick<pg.Pool, 'query'>,
  notification: Pick<ProjectNotification, 'id' | 'attempts'>,
  code: string,
) => outbox.fail(database, notification, code, false);
