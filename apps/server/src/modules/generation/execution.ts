import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { CreditJob } from '../credits/service.js';
import { GENERATION_DEADLINE_MINUTES, GENERATION_LEASE_MINUTES, ImageGenerationError } from '../../infra/image-provider.js';

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
  const updated = await database.query(`UPDATE ${job.kind}_jobs SET lease_until = LEAST(execution_deadline, now() + make_interval(mins => $3)),
    phase = $4, updated_at = now() WHERE id = $1 AND lease_token = $2
    AND status IN ('running', 'settling') AND execution_deadline > now() RETURNING id`,
  [job.id, lease, GENERATION_LEASE_MINUTES, phase]);
  if (!updated.rowCount) throw new ImageGenerationError('GENERATION_LEASE_LOST_OR_EXPIRED');
}

export async function publishGeneration(publish: (jobId: string, event: unknown) => Promise<void>, jobId: string, event: unknown) {
  try { await publish(jobId, event); } catch {}
}
