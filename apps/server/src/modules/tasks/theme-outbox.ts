import type pg from 'pg';
import type { Queue } from 'bullmq';
import { transaction } from '../../infra/database.js';
import { THEME_TASK_NAME } from '../../infra/queue.js';

export async function reconcileThemeOutbox(database: pg.Pool): Promise<number> {
  return transaction(database, async client => {
    const stale = await client.query<{ id: string }>(
      `SELECT id FROM theme_jobs
       WHERE status IN ('pending', 'queued') AND updated_at < now() - interval '15 minutes'
       ORDER BY updated_at, id LIMIT 10 FOR UPDATE SKIP LOCKED`,
    );
    for (const { id } of stale.rows) {
      await client.query(
        `INSERT INTO theme_job_outbox (job_id) VALUES ($1)
         ON CONFLICT (job_id) DO UPDATE SET picked_at = NULL`, [id],
      );
      await client.query('UPDATE theme_jobs SET updated_at = now() WHERE id = $1', [id]);
    }
    return stale.rows.length;
  });
}

export async function dispatchThemeOutbox(database: pg.Pool, queue: Pick<Queue, 'add' | 'getJob'>): Promise<void> {
  await transaction(database, async client => {
    const pending = await client.query<{ jobId: string; status: string }>(
      `SELECT o.job_id AS "jobId", j.status FROM theme_job_outbox o
       JOIN theme_jobs j ON j.id = o.job_id
       WHERE o.picked_at IS NULL
       ORDER BY o.created_at
       LIMIT 10
       FOR UPDATE OF j, o SKIP LOCKED`
    );
    for (const { jobId, status } of pending.rows) {
      if (status === 'pending' || status === 'queued') {
        const existing = await queue.getJob(jobId);
        const state = await existing?.getState();
        if (existing && (state === 'failed' || state === 'completed')) {
          await existing.retry(state);
        } else {
          await queue.add(THEME_TASK_NAME, { jobId }, {
            jobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          });
        }
      }
      await client.query(
        `UPDATE theme_job_outbox SET picked_at = now() WHERE job_id = $1`,
        [jobId]
      );
      await client.query(
        `UPDATE theme_jobs SET status = 'queued', updated_at = now() WHERE id = $1 AND status = 'pending'`,
        [jobId]
      );
    }
  });
}
