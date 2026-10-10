import type pg from 'pg';
import type { ProjectStatus } from '../projects/domain.js';

export type WorkspaceTaskReason = 'overdue' | 'today' | 'pending';

export interface WorkspaceTask {
  projectId: string;
  projectNo: string;
  company: string | null;
  contactName: string | null;
  exhibitionName: string | null;
  status: ProjectStatus;
  reason: WorkspaceTaskReason;
  nextFollowUpAt: string | null;
  createdAt: string;
}

export interface WorkspaceActivity {
  id: string;
  kind: string;
  projectId: string;
  projectNo: string;
  actorName: string | null;
  byMe: boolean;
  fromStatus: ProjectStatus | null;
  toStatus: ProjectStatus | null;
  schemeCode: string | null;
  quotationRevision: number | null;
  createdAt: string;
}

type TaskRow = Omit<WorkspaceTask, 'nextFollowUpAt' | 'createdAt'> & { nextFollowUpAt: Date | null; createdAt: Date };
type ActivityRow = Omit<WorkspaceActivity, 'createdAt'> & { createdAt: Date };

const timeZone = 'Asia/Shanghai';
const taskLimit = 10;
const activityLimit = 10;

// 当前管理员负责的未结束项目，附带最新一条跟进记录约定的下次跟进时间；口径与业务总览一致。
const mine = `WITH mine AS (
    SELECT p.id,p.project_no,p.status,p.created_at,p.request_snapshot,(f.payload->>'nextFollowUpAt')::timestamptz AS next_follow_up_at
    FROM projects p LEFT JOIN LATERAL (
      SELECT payload FROM project_events WHERE project_id=p.id AND kind='follow-up'
      ORDER BY created_at DESC,id DESC LIMIT 1
    ) f ON true WHERE p.assignee_admin_id=$1 AND p.status IN ('pending','following','quoted')
  ), bounds AS (
    SELECT (date_trunc('day',now() AT TIME ZONE '${timeZone}') AT TIME ZONE '${timeZone}') AS start_at
  ), classified AS (
    SELECT mine.*,CASE WHEN next_follow_up_at < now() THEN 'overdue'
      WHEN next_follow_up_at >= start_at AND next_follow_up_at < start_at + interval '1 day' THEN 'today'
      WHEN status='pending' THEN 'pending' END AS reason
    FROM mine CROSS JOIN bounds
  )`;

async function projectsSection(pool: pg.Pool, adminId: string) {
  const [counts, tasks, activities] = await Promise.all([
    pool
      .query<{ active: number; pending: number; todayFollowUps: number; overdueFollowUps: number; taskTotal: number }>(
        `${mine}
      SELECT count(*)::int AS active,count(*) FILTER (WHERE status='pending')::int AS pending,
        count(*) FILTER (WHERE next_follow_up_at >= start_at AND next_follow_up_at < start_at + interval '1 day')::int AS "todayFollowUps",
        count(*) FILTER (WHERE next_follow_up_at < now())::int AS "overdueFollowUps",
        count(*) FILTER (WHERE reason IS NOT NULL)::int AS "taskTotal"
      FROM classified CROSS JOIN bounds`,
        [adminId],
      )
      .then(result => result.rows[0]!),
    pool
      .query<TaskRow>(
        `${mine}
      SELECT id AS "projectId",project_no AS "projectNo",nullif(request_snapshot->>'company','') AS company,
        request_snapshot->'contact'->>'name' AS "contactName",request_snapshot->'exhibition'->>'name' AS "exhibitionName",
        status,reason,next_follow_up_at AS "nextFollowUpAt",created_at AS "createdAt"
      FROM classified WHERE reason IS NOT NULL
      ORDER BY CASE reason WHEN 'overdue' THEN 0 WHEN 'today' THEN 1 ELSE 2 END,next_follow_up_at ASC NULLS LAST,created_at ASC,id ASC
      LIMIT ${taskLimit}`,
        [adminId],
      )
      .then(result => result.rows),
    pool
      .query<ActivityRow>(
        `SELECT e.id,e.kind,e.project_id AS "projectId",p.project_no AS "projectNo",
        coalesce(a.nickname,a.username) AS "actorName",coalesce(e.actor_admin_id=$1,false) AS "byMe",
        CASE WHEN e.kind='follow-up' THEN e.payload->>'fromStatus' END AS "fromStatus",
        CASE WHEN e.kind='follow-up' THEN e.payload->>'status' END AS "toStatus",
        CASE WHEN e.kind='scheme' THEN e.payload->>'schemeCode' END AS "schemeCode",
        CASE WHEN e.kind='quotation' THEN (e.payload->>'quotationRevision')::int END AS "quotationRevision",
        e.created_at AS "createdAt"
      FROM project_events e JOIN projects p ON p.id=e.project_id LEFT JOIN admins a ON a.id=e.actor_admin_id
      WHERE p.assignee_admin_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT ${activityLimit}`,
        [adminId],
      )
      .then(result => result.rows),
  ]);
  return {
    ...counts,
    tasks: tasks.map(task => ({
      ...task,
      nextFollowUpAt: task.nextFollowUpAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
    })),
    activities: activities.map(activity => ({ ...activity, createdAt: activity.createdAt.toISOString() })),
  };
}

/**
 * 工作台只展示当前管理员本人的待办：负责的未结束项目、需处理的跟进、负责项目的最新动态与本人未读消息。
 * 每个分组在拥有对应模块查看权限时才查询，未授权分组返回 null。
 */
export async function getDashboardWorkspace(pool: pg.Pool, adminId: string, permissions: string[]) {
  const granted = new Set(permissions);
  const [projects, notifications] = await Promise.all([
    granted.has('projects.read') ? projectsSection(pool, adminId) : null,
    granted.has('notifications.read')
      ? pool
          .query<{ unread: number }>(
            `SELECT count(*)::int AS unread FROM project_notification_outbox o
      WHERE NOT EXISTS (SELECT 1 FROM project_notification_reads r WHERE r.notification_id=o.id AND r.admin_id=$1)`,
            [adminId],
          )
          .then(result => result.rows[0]!)
      : null,
  ]);
  return { projects, notifications, generatedAt: new Date().toISOString(), timeZone };
}
