import type pg from 'pg';
import type { ProjectStatus } from '../projects/domain.js';

export interface RecentInquiry {
  projectId: string;
  projectNo: string;
  company: string | null;
  contactName: string | null;
  status: ProjectStatus;
  createdAt: Date;
}

export async function getDashboardSummary(pool: pg.Pool, permissions: string[]) {
  const granted = new Set(permissions);
  const [projects, schemes, generation, notifications] = await Promise.all([
    granted.has('projects.read') ? projectSummary(pool) : null,
    granted.has('schemes.read') ? pool.query<{ unverified: number }>(
      `SELECT count(*) FILTER (WHERE verification_status='unverified')::int AS unverified FROM schemes`,
    ).then(result => result.rows[0]!) : null,
    granted.has('generation.read') ? pool.query<{ failed: number }>(
      `SELECT ((SELECT count(*) FROM theme_jobs WHERE status='failed') +
        (SELECT count(*) FROM artwork_jobs WHERE status='failed'))::int AS failed`,
    ).then(result => result.rows[0]!) : null,
    granted.has('notifications.read') ? pool.query<{ failed: number }>(
      `SELECT count(*)::int AS failed FROM project_notification_outbox
       WHERE failed_at IS NOT NULL AND delivered_at IS NULL`,
    ).then(result => result.rows[0]!) : null,
  ]);
  return { projects, schemes, generation, notifications, generatedAt: new Date().toISOString(), timeZone: 'Asia/Shanghai' };
}

async function projectSummary(pool: pg.Pool) {
  const [counts, recent] = await Promise.all([
    pool.query<{ pending: number; todayFollowUps: number; overdueFollowUps: number }>(`
      WITH active AS (
        SELECT p.status,f.payload->>'nextFollowUpAt' AS next_follow_up_at
        FROM projects p LEFT JOIN LATERAL (
          SELECT payload FROM project_events WHERE project_id=p.id AND kind='follow-up'
          ORDER BY created_at DESC,id DESC LIMIT 1
        ) f ON true WHERE p.status IN ('pending','following','quoted')
      ), bounds AS (
        SELECT (date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS start_at
      )
      SELECT count(*) FILTER (WHERE status='pending')::int AS pending,
        count(*) FILTER (WHERE next_follow_up_at::timestamptz >= start_at
          AND next_follow_up_at::timestamptz < start_at + interval '1 day')::int AS "todayFollowUps",
        count(*) FILTER (WHERE next_follow_up_at::timestamptz < now())::int AS "overdueFollowUps"
      FROM active CROSS JOIN bounds`),
    pool.query<RecentInquiry>(`SELECT id AS "projectId",project_no AS "projectNo",
      nullif(request_snapshot->>'company','') AS company,request_snapshot->'contact'->>'name' AS "contactName",
      status,created_at AS "createdAt" FROM projects WHERE source_type='quote_request'
      ORDER BY created_at DESC,id DESC LIMIT 5`),
  ]);
  return { ...counts.rows[0]!, recentInquiries: recent.rows.map(item => ({ ...item, createdAt: item.createdAt.toISOString() })) };
}
