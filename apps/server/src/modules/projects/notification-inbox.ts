import type pg from 'pg';
import { projectError } from './domain.js';

// Admin-facing view over project_notification_outbox. Read state is per admin and never affects channel delivery.
export type NotificationDelivery = 'pending' | 'delivered' | 'failed';

export interface NotificationInboxQuery {
  page?: number;
  pageSize?: number;
  isRead?: boolean;
  kind?: string;
  projectNo?: string;
}
export interface NotificationInboxItem {
  id: string;
  eventId: string;
  kind: string;
  projectId: string;
  projectNo: string;
  sourceType: string;
  company: string | null;
  contactName: string | null;
  exhibitionName: string | null;
  occurredAt: string;
  isRead: boolean;
  readAt: string | null;
  delivery: NotificationDelivery;
  /** 可见范围：assigners 为待分配通知，recipient 为发给本人的分配通知 */
  audience: 'all' | 'assigners' | 'recipient';
}
export interface NotificationInboxDetail extends NotificationInboxItem {
  payload: unknown;
  status: string;
  schemeCode: string | null;
  assigneeName: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  attempts: number;
  lastErrorCode: string | null;
}

type Row = Omit<NotificationInboxItem, 'occurredAt' | 'readAt'> & { occurredAt: Date; readAt: Date | null };
type DetailRow = Row &
  Pick<NotificationInboxDetail, 'payload' | 'status' | 'schemeCode' | 'assigneeName' | 'attempts' | 'lastErrorCode'> & {
    deliveredAt: Date | null;
    failedAt: Date | null;
  };

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);
const itemColumns = `o.id,o.event_id AS "eventId",e.kind,o.project_id AS "projectId",p.project_no AS "projectNo",p.source_type AS "sourceType",
  nullif(p.request_snapshot->>'company','') AS company,p.request_snapshot->'contact'->>'name' AS "contactName",
  p.request_snapshot->'exhibition'->>'name' AS "exhibitionName",e.created_at AS "occurredAt",(r.read_at IS NOT NULL) AS "isRead",r.read_at AS "readAt",
  CASE WHEN o.delivered_at IS NOT NULL THEN 'delivered' WHEN o.failed_at IS NOT NULL THEN 'failed' ELSE 'pending' END AS delivery,o.audience`;
const joins = `FROM project_notification_outbox o JOIN project_events e ON e.id=o.event_id JOIN projects p ON p.id=o.project_id
  LEFT JOIN project_notification_reads r ON r.notification_id=o.id AND r.admin_id=$1`;

/**
 * 通知可见范围（迁移 089）：all 全员可见，assigners 只对有分配权限（projects.assign）的人可见，recipient 只对指定管理员可见。
 * 参数固定为 $1 = 当前管理员 ID、$2 = 是否有分配权限。
 */
export function visibleNotificationSql(alias: string): string {
  return `(${alias}.audience='all' OR (${alias}.audience='assigners' AND $2::boolean) OR (${alias}.audience='recipient' AND ${alias}.recipient_admin_id=$1))`;
}
const visible = visibleNotificationSql('o');

/** 当前管理员可见的未读通知数（工作台共用） */
export async function unreadNotificationCount(db: Pick<pg.Pool, 'query'>, adminId: string, canAssign: boolean): Promise<number> {
  const row = (
    await db.query<{ unread: number }>(
      `SELECT count(*)::int AS unread FROM project_notification_outbox o
    WHERE ${visible} AND NOT EXISTS (SELECT 1 FROM project_notification_reads r WHERE r.notification_id=o.id AND r.admin_id=$1)`,
      [adminId, canAssign],
    )
  ).rows[0];
  return row?.unread ?? 0;
}

function item(row: Row): NotificationInboxItem {
  return { ...row, occurredAt: new Date(row.occurredAt).toISOString(), readAt: iso(row.readAt) };
}

export async function listNotificationInbox(
  db: Pick<pg.Pool, 'query'>,
  adminId: string,
  canAssign: boolean,
  query: NotificationInboxQuery,
) {
  const args: unknown[] = [adminId, canAssign];
  const conditions: string[] = [visible];
  const add = (clause: string, value: unknown) => {
    args.push(value);
    conditions.push(clause.replace('?', `$${args.length}`));
  };
  if (query.isRead !== undefined) conditions.push(query.isRead ? 'r.read_at IS NOT NULL' : 'r.read_at IS NULL');
  if (query.kind) add('e.kind=?', query.kind);
  if (query.projectNo) add('p.project_no ILIKE ?', `%${query.projectNo.replace(/[\\%_]/g, '\\$&')}%`);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const [rows, count, unreadCount] = await Promise.all([
    db.query<Row>(
      `SELECT ${itemColumns} ${joins} ${where} ORDER BY o.created_at DESC,o.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, pageSize, (page - 1) * pageSize],
    ),
    db.query<{ total: string }>(`SELECT count(*)::text AS total ${joins} ${where}`, args),
    unreadNotificationCount(db, adminId, canAssign),
  ]);
  return {
    items: rows.rows.map(item),
    total: Number(count.rows[0]?.total ?? 0),
    unreadCount,
    page,
    pageSize,
  };
}

export async function getNotificationInboxDetail(
  db: Pick<pg.Pool, 'query'>,
  adminId: string,
  canAssign: boolean,
  id: string,
): Promise<NotificationInboxDetail> {
  const row = (
    await db.query<DetailRow>(
      `SELECT ${itemColumns},e.payload,p.status,p.scheme_code AS "schemeCode",coalesce(a.nickname,a.username) AS "assigneeName",
    o.delivered_at AS "deliveredAt",o.failed_at AS "failedAt",o.attempts,o.last_error_code AS "lastErrorCode"
    ${joins} LEFT JOIN admins a ON a.id=p.assignee_admin_id WHERE o.id=$3 AND ${visible}`,
      [adminId, canAssign, id],
    )
  ).rows[0];
  if (!row) throw projectError('RESOURCE_NOT_FOUND', 404);
  return {
    ...item(row),
    payload: row.payload,
    status: row.status,
    schemeCode: row.schemeCode,
    assigneeName: row.assigneeName,
    deliveredAt: iso(row.deliveredAt),
    failedAt: iso(row.failedAt),
    attempts: row.attempts,
    lastErrorCode: row.lastErrorCode,
  };
}

// 不可见的通知按不存在处理
export async function markNotificationRead(db: Pick<pg.Pool, 'query'>, adminId: string, canAssign: boolean, id: string): Promise<void> {
  const { rowCount } = await db.query(
    `INSERT INTO project_notification_reads(notification_id,admin_id)
    SELECT id,$1 FROM project_notification_outbox o WHERE id=$3 AND ${visible} ON CONFLICT DO NOTHING`,
    [adminId, canAssign, id],
  );
  if (
    !rowCount &&
    !(await db.query(`SELECT 1 FROM project_notification_outbox o WHERE id=$3 AND ${visible}`, [adminId, canAssign, id])).rowCount
  )
    throw projectError('RESOURCE_NOT_FOUND', 404);
}

export async function markAllNotificationsRead(db: Pick<pg.Pool, 'query'>, adminId: string, canAssign: boolean): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO project_notification_reads(notification_id,admin_id)
    SELECT id,$1 FROM project_notification_outbox o WHERE ${visible} ON CONFLICT DO NOTHING`,
    [adminId, canAssign],
  );
  return rowCount ?? 0;
}
