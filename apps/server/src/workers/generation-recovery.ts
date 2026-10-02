import type pg from 'pg';
import type { Queue } from 'bullmq';
import { ARTWORK_TASK_NAME, THEME_TASK_NAME } from '../infra/queue.js';
import { settleArtworkJob } from '../modules/generation/artwork/execution.js';
import { settleThemeJob } from '../modules/generation/theme/execution.js';

export async function recoverGenerationJobs(database: pg.Pool, queues: Record<'theme' | 'artwork', Pick<Queue, 'getJob' | 'add'>>) {
  for (const kind of ['theme', 'artwork'] as const) {
    const candidates = await database.query<{ id: string; expired: boolean }>(`SELECT id,
      COALESCE(execution_deadline, updated_at + interval '30 minutes') <= now() AS expired FROM ${kind}_jobs
      WHERE status IN ('running', 'settling') AND (lease_until IS NULL OR lease_until < now())
      AND (execution_deadline <= now() OR updated_at < now() - interval '15 minutes')
      ORDER BY updated_at, id LIMIT 100`);
    for (const candidate of candidates.rows) {
      if (candidate.expired) {
        if (kind === 'theme') await settleThemeJob(database, candidate.id);
        else await settleArtworkJob(database, candidate.id);
        continue;
      }
      const existing = await queues[kind].getJob(candidate.id);
      const state = await existing?.getState();
      if (existing && (state === 'completed' || state === 'failed')) await existing.retry(state);
      else if (!existing) await queues[kind].add(kind === 'theme' ? THEME_TASK_NAME : ARTWORK_TASK_NAME, { jobId: candidate.id }, {
        jobId: candidate.id, attempts: 3, backoff: { type: 'exponential', delay: 2000 },
      });
    }
  }
}
