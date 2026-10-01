import type pg from 'pg';
import type { Queue } from 'bullmq';
import { ARTWORK_TASK_NAME } from '../../infra/queue.js';
import { settleArtworkJob, type PublishArtworkEvent } from './artwork-worker.js';

export async function dispatchArtworkOutbox(database: pg.Pool, queue: Queue, publish: PublishArtworkEvent = async () => {}): Promise<void> {
  const abandoned = (await database.query<{ id: string }>(`SELECT id FROM artwork_jobs
    WHERE status IN ('running','settling') AND updated_at<now()-interval '15 minutes'
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY updated_at LIMIT 10`)).rows;
  for (const { id } of abandoned) await settleArtworkJob(database, id, undefined, publish);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const pending = await client.query<{ jobId: string }>(
      `SELECT job_id AS "jobId" FROM artwork_job_outbox
       WHERE picked_at IS NULL
       ORDER BY created_at
       LIMIT 10
       FOR UPDATE SKIP LOCKED`
    );
    if (pending.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }
    for (const { jobId } of pending.rows) {
      await queue.add(ARTWORK_TASK_NAME, { jobId }, {
        jobId, attempts: 3, backoff: { type: 'exponential', delay: 2000 },
      });
      await client.query(
        `UPDATE artwork_job_outbox SET picked_at = now() WHERE job_id = $1`,
        [jobId]
      );
      await client.query(
        `UPDATE artwork_jobs SET status = 'queued', updated_at = now() WHERE id = $1 AND status = 'pending'`,
        [jobId]
      );
    }
    await client.query('COMMIT');
    for (const { jobId } of pending.rows) await publish(jobId, { status: 'queued' }).catch(() => {});

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
