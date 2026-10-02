import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { CreditJob } from '../credits/service.js';
import { GENERATION_DEADLINE_MINUTES, GENERATION_LEASE_MINUTES, ImageGenerationError } from '../../infra/image-provider.js';
import { logger } from '../../infra/logger.js';

export async function claimGeneration(database: pg.Pool, job: CreditJob) {
  const lease = randomUUID();
  const claimed = await database.query<{ deadline: Date }>(`UPDATE ${job.kind}_jobs SET lease_token = $2,
    lease_until = LEAST(COALESCE(execution_deadline, now() + make_interval(mins => $4)), now() + make_interval(mins => $3)),
    execution_deadline = COALESCE(execution_deadline, now() + make_interval(mins => $4)),
    status = 'running', updated_at = now() WHERE id = $1 AND status IN ('pending', 'queued', 'running', 'settling')
    AND (lease_until IS NULL OR lease_until < now()) RETURNING execution_deadline AS deadline`,
  [job.id, lease, GENERATION_LEASE_MINUTES, GENERATION_DEADLINE_MINUTES]);
  const row = claimed.rows[0];
  if (!row) {
    const state = (await database.query<{ status: string }>(`SELECT status FROM ${job.kind}_jobs WHERE id = $1`, [job.id])).rows[0];
    if (state && ['pending', 'queued', 'running', 'settling'].includes(state.status)) throw new ImageGenerationError('GENERATION_LEASE_BUSY', true);
    return;
  }
  return { lease, deadline: new Date(row.deadline) };
}

export async function refreshGeneration(database: pg.Pool, job: CreditJob, lease: string, phase: string) {
  const updated = await database.query<{ previousPhase: string | null; previousMs: number | null }>(`UPDATE ${job.kind}_jobs j
    SET lease_until = LEAST(j.execution_deadline, now() + make_interval(mins => $3)), phase = $4, updated_at = now(),
      phase_started_at = CASE WHEN j.phase IS DISTINCT FROM $4 OR j.phase_started_at IS NULL THEN now() ELSE j.phase_started_at END
    FROM ${job.kind}_jobs previous WHERE j.id = $1 AND previous.id = j.id AND j.lease_token = $2
    AND j.status IN ('running', 'settling') AND j.execution_deadline > now()
    RETURNING CASE WHEN previous.phase IS DISTINCT FROM $4 THEN previous.phase END AS "previousPhase",
      (EXTRACT(EPOCH FROM now() - previous.phase_started_at) * 1000)::int AS "previousMs"`,
  [job.id, lease, GENERATION_LEASE_MINUTES, phase]);
  const row = updated.rows[0];
  if (!row) throw new ImageGenerationError('GENERATION_LEASE_LOST_OR_EXPIRED');
  if (row.previousPhase && row.previousMs !== null) {
    logger.info({ jobKind: job.kind, jobId: job.id, phase: row.previousPhase, durationMs: row.previousMs, nextPhase: phase }, 'Generation phase completed');
  }
}

export async function publishGeneration(publish: (jobId: string, event: unknown) => Promise<void>, jobId: string, event: unknown) {
  try { await publish(jobId, event); } catch {}
}
