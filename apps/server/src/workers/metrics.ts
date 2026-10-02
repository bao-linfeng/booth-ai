import type pg from 'pg';
import type { Queue } from 'bullmq';

type QueueCounts = Pick<Queue, 'getJobCounts'>;

interface JobWindow { completed: number; failed: number; waitMsTotal: number; waitMsMax: number; runMsTotal: number; runMsMax: number }

// In-process per-queue timing since the previous snapshot; complements the durable counts read from Redis/Postgres.
export function createJobStats() {
  const windows = new Map<string, JobWindow>();
  return {
    record(queue: string, outcome: 'completed' | 'failed', waitMs: number, runMs: number) {
      const window = windows.get(queue) ?? { completed: 0, failed: 0, waitMsTotal: 0, waitMsMax: 0, runMsTotal: 0, runMsMax: 0 };
      window[outcome]++;
      window.waitMsTotal += waitMs; window.waitMsMax = Math.max(window.waitMsMax, waitMs);
      window.runMsTotal += runMs; window.runMsMax = Math.max(window.runMsMax, runMs);
      windows.set(queue, window);
    },
    drain() {
      const snapshot = Object.fromEntries([...windows].map(([queue, w]) => {
        const count = w.completed + w.failed;
        return [queue, { completed: w.completed, failed: w.failed, waitMsAvg: count ? Math.round(w.waitMsTotal / count) : 0, waitMsMax: w.waitMsMax,
          runMsAvg: count ? Math.round(w.runMsTotal / count) : 0, runMsMax: w.runMsMax }];
      }));
      windows.clear();
      return snapshot;
    },
  };
}

export async function collectWorkerMetrics(database: Pick<pg.Pool, 'query'>, queues: Record<string, QueueCounts>) {
  const queueEntries = await Promise.all(Object.entries(queues).map(async ([name, queue]) =>
    [name, await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'prioritized')] as const));
  const outbox = await database.query<{ name: string; pending: number; oldestSeconds: number | null }>(
    `SELECT 'foundation' AS name, count(*)::int AS pending, EXTRACT(EPOCH FROM now() - min(created_at))::float8 AS "oldestSeconds" FROM foundation_outbox WHERE published_at IS NULL
     UNION ALL SELECT 'theme', count(*)::int, EXTRACT(EPOCH FROM now() - min(created_at))::float8 FROM theme_job_outbox WHERE picked_at IS NULL
     UNION ALL SELECT 'artwork', count(*)::int, EXTRACT(EPOCH FROM now() - min(created_at))::float8 FROM artwork_job_outbox WHERE picked_at IS NULL
     UNION ALL SELECT 'project_notification', count(*)::int, EXTRACT(EPOCH FROM now() - min(created_at))::float8
       FROM project_notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL`);
  const notificationsFailed = (await database.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM project_notification_outbox WHERE failed_at IS NOT NULL AND delivered_at IS NULL')).rows[0]?.count ?? 0;
  // Reservations still held after the job's execution deadline or terminal state indicate a settlement gap.
  const overdueReservations = (await database.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM credit_reservations r
     LEFT JOIN theme_jobs t ON t.id = r.theme_job_id LEFT JOIN artwork_jobs a ON a.id = r.artwork_job_id
     WHERE r.status = 'reserved' AND (COALESCE(t.execution_deadline, a.execution_deadline) < now()
       OR COALESCE(t.status::text, a.status::text) IN ('succeeded', 'partially_succeeded', 'failed'))`)).rows[0]?.count ?? 0;
  const phases = await database.query<{ kind: string; phase: string | null; jobs: number; maxPhaseSeconds: number | null }>(
    `SELECT 'theme' AS kind, phase, count(*)::int AS jobs, max(EXTRACT(EPOCH FROM now() - COALESCE(phase_started_at, updated_at)))::float8 AS "maxPhaseSeconds"
       FROM theme_jobs WHERE status IN ('running', 'settling') GROUP BY phase
     UNION ALL SELECT 'artwork', phase, count(*)::int, max(EXTRACT(EPOCH FROM now() - COALESCE(phase_started_at, updated_at)))::float8
       FROM artwork_jobs WHERE status IN ('running', 'settling') GROUP BY phase`);
  return {
    queues: Object.fromEntries(queueEntries),
    outbox: Object.fromEntries(outbox.rows.map(row => [row.name, { pending: row.pending, oldestSeconds: row.oldestSeconds === null ? null : Math.round(row.oldestSeconds) }])),
    projectNotificationsFailed: notificationsFailed,
    overdueCreditReservations: overdueReservations,
    runningPhases: phases.rows.map(row => ({ kind: row.kind, phase: row.phase, jobs: row.jobs, maxPhaseSeconds: row.maxPhaseSeconds === null ? null : Math.round(row.maxPhaseSeconds) })),
  };
}
