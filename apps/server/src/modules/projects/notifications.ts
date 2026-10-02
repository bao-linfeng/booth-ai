import type pg from 'pg';

// Notification delivery is a side effect: it never decides whether a project was accepted.
// Consumers must de-duplicate on eventId because a crash after delivery and before completion re-sends the event.
export const PROJECT_NOTIFICATION_MAX_ATTEMPTS = 8;
const LEASE_SECONDS = 60;

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
}

export function projectNotificationBackoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 3600);
}

// Claims are short leases taken in a single statement, so no row lock is held while calling the channel.
export async function claimProjectNotifications(database: Pick<pg.Pool, 'query'>, limit = 10): Promise<ProjectNotification[]> {
  const { rows } = await database.query<Omit<ProjectNotification, 'occurredAt'> & { occurredAt: Date }>(
    `UPDATE project_notification_outbox o SET attempts = o.attempts + 1, locked_until = now() + make_interval(secs => $2)
     FROM (SELECT id FROM project_notification_outbox
           WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now() AND (locked_until IS NULL OR locked_until < now())
           ORDER BY next_attempt_at, created_at LIMIT $1 FOR UPDATE SKIP LOCKED) c, project_events e, projects p
     WHERE o.id = c.id AND e.id = o.event_id AND p.id = o.project_id
     RETURNING o.id, o.event_id AS "eventId", o.project_id AS "projectId", p.project_no AS "projectNo", p.source_type AS "sourceType",
       e.kind, e.payload, e.created_at AS "occurredAt", o.attempts`, [limit, LEASE_SECONDS]);
  return rows.map(row => ({ ...row, occurredAt: new Date(row.occurredAt).toISOString() }));
}

export async function completeProjectNotification(database: Pick<pg.Pool, 'query'>, id: string): Promise<void> {
  await database.query(`UPDATE project_notification_outbox SET delivered_at = now(), locked_until = NULL, last_error_code = NULL
    WHERE id = $1 AND delivered_at IS NULL`, [id]);
}

// Returns true when the event exhausted its retries and needs manual follow-up.
export async function failProjectNotification(database: Pick<pg.Pool, 'query'>, notification: Pick<ProjectNotification, 'id' | 'attempts'>, code: string): Promise<boolean> {
  const exhausted = notification.attempts >= PROJECT_NOTIFICATION_MAX_ATTEMPTS;
  await database.query(`UPDATE project_notification_outbox SET locked_until = NULL, last_error_code = $2,
    next_attempt_at = now() + make_interval(secs => $3), failed_at = CASE WHEN $4::boolean THEN now() END
    WHERE id = $1 AND delivered_at IS NULL`, [notification.id, code.slice(0, 64), projectNotificationBackoffSeconds(notification.attempts), exhausted]);
  return exhausted;
}
