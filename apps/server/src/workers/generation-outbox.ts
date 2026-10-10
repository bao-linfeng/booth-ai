import type pg from 'pg';
import type { Queue } from 'bullmq';
import { transaction } from '../infra/database.js';
import { ARTWORK_TASK_NAME, THEME_TASK_NAME } from '../infra/queue.js';
import { publishGeneration } from '../modules/generation/execution.js';

export type GenerationKind = 'theme' | 'artwork';
export type PublishGenerationEvent = (jobId: string, event: unknown) => Promise<void>;

const TASK_NAMES: Record<GenerationKind, string> = { theme: THEME_TASK_NAME, artwork: ARTWORK_TASK_NAME };

/** jobId 即任务 ID：已存在的队列记录会被 BullMQ 去重，重复调用是幂等的。 */
export function enqueueGenerationJob(queue: Pick<Queue, 'add'>, kind: GenerationKind, jobId: string) {
  return queue.add(TASK_NAMES[kind], { jobId }, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
}

// The job row stays locked until COMMIT, so a consumer cannot claim it before the outbox marker is durable.
// A crash after add() is safe: the next dispatch re-adds the same jobId, which BullMQ deduplicates.
// Queue records that are already terminal are left to generation recovery, which owns the retry-or-settle decision.
export async function dispatchGenerationOutbox(
  database: pg.Pool,
  kind: GenerationKind,
  queue: Pick<Queue, 'add'>,
  publish: PublishGenerationEvent = async () => {},
): Promise<number> {
  const queued = await transaction(database, async client => {
    const pending = await client.query<{ jobId: string; status: string }>(
      `SELECT o.job_id AS "jobId", j.status::text AS status FROM ${kind}_job_outbox o
       JOIN ${kind}_jobs j ON j.id = o.job_id
       WHERE o.picked_at IS NULL
       ORDER BY o.created_at
       LIMIT 10
       FOR UPDATE OF j, o SKIP LOCKED`,
    );
    const dispatched: string[] = [];
    for (const { jobId, status } of pending.rows) {
      if (status === 'pending' || status === 'queued') {
        await enqueueGenerationJob(queue, kind, jobId);
        dispatched.push(jobId);
      }
      await client.query(`UPDATE ${kind}_job_outbox SET picked_at = now() WHERE job_id = $1`, [jobId]);
      await client.query(`UPDATE ${kind}_jobs SET status = 'queued', updated_at = now() WHERE id = $1 AND status = 'pending'`, [jobId]);
    }
    return dispatched;
  });
  for (const jobId of queued) await publishGeneration(publish, jobId, { status: 'queued' });
  return queued.length;
}
