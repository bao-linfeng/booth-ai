import type pg from 'pg';
import type { Queue } from 'bullmq';
import { transaction } from '../../infra/database.js';
import { THEME_TASK_NAME, ARTWORK_TASK_NAME } from '../../infra/queue.js';
import { settleThemeJob } from '../tasks/theme-worker.js';
import { settleArtworkJob } from '../tasks/artwork-worker.js';
import { lockCreditJob, releaseJobCredits, reserveJobCredits, terminalCreditJob, type CreditJob } from './service.js';

type CreditQueues = Record<CreditJob['kind'], Pick<Queue, 'getJob' | 'add'>>;
type CreditIssue = CreditJob & { reason: string };

export async function reconcileJobCredits(database: pg.Pool, queues: CreditQueues): Promise<{ checked: number; repaired: number; issues: CreditIssue[] }> {
  const report = { checked: 0, repaired: 0, issues: [] as CreditIssue[] };
  for (const kind of ['theme', 'artwork'] as const) {
    const jobs = (await database.query<{ id: string; status: string; stale: boolean }>(
      `SELECT id, status, updated_at < now() - interval '15 minutes' AS stale FROM ${kind}_jobs
       WHERE credit_checked_at IS NULL OR credit_checked_at < now() - interval '1 minute'
       ORDER BY credit_checked_at NULLS FIRST, id LIMIT 100`,
    )).rows;
    for (const candidate of jobs) {
      const job = { kind, id: candidate.id };
      try {
        const outcome = await transaction(database, async client => {
          const current = await lockCreditJob(client, job);
          if (!current) return { repaired: false };
          await client.query(`UPDATE ${kind}_jobs SET credit_checked_at = now() WHERE id = $1`, [job.id]);
          const reservation = (await client.query<{ userId: string; amount: number; status: string }>(
            `SELECT user_id AS "userId", reserved_amount AS amount, status FROM credit_reservations WHERE ${kind}_job_id = $1 FOR UPDATE`, [job.id],
          )).rows[0];
          const charge = (await client.query<{ userId: string; amount: number; kind: string }>(
            `SELECT user_id AS "userId", amount, kind FROM credit_transactions WHERE ${kind}_job_id = $1`, [job.id],
          )).rows[0];
          if (reservation && reservation.userId !== current.userId) return { reason: 'RESERVATION_OWNER_MISMATCH', repaired: false };
          if (current.status === 'failed') {
            if (charge) return { reason: 'FAILED_JOB_CHARGED', repaired: false };
            if (reservation && reservation.status !== 'released') {
              await releaseJobCredits(client, job);
              return { repaired: true };
            }
            return { repaired: false };
          }
          if (current.cacheHit) {
            if (charge) return { reason: 'CACHED_JOB_CHARGED', repaired: false };
            if (reservation && reservation.status !== 'released') {
              await client.query(`UPDATE credit_reservations SET status = 'released', updated_at = now() WHERE ${kind}_job_id = $1`, [job.id]);
              return { repaired: true };
            }
            return { repaired: false };
          }
          if (terminalCreditJob(current.status)) {
            if (current.usableCount === 0 && !charge) {
              const results = await client.query(`SELECT 1 FROM ${kind}_job_results WHERE job_id = $1 LIMIT 1`, [job.id]);
              if (results.rows.length) return { reason: 'TERMINAL_RESULT_MISMATCH', repaired: false };
              await client.query(`UPDATE ${kind}_jobs SET status = 'failed', phase = NULL, lease_token = NULL,
                lease_until = NULL, updated_at = now()${kind === 'artwork' ? ", delivery_status = 'incomplete'" : ''} WHERE id = $1`, [job.id]);
              if (kind === 'artwork') {
                await client.query(`UPDATE artwork_job_directions SET status = 'failed',
                  reason = COALESCE(reason, 'PROCESSING_FAILED'), generated_url = NULL, updated_at = now() WHERE job_id = $1`, [job.id]);
              }
              await releaseJobCredits(client, job);
              return { repaired: true };
            }
            if (!charge || current.unitCredits === null || charge.amount !== -current.usableCount * current.unitCredits ||
                charge.userId !== current.userId || charge.kind !== `${kind}_consume`) return { reason: 'TERMINAL_CHARGE_MISMATCH', repaired: false };
            if (!reservation) return { reason: 'TERMINAL_RESERVATION_MISSING', repaired: false };
            if (reservation.amount !== current.requestedCount * current.unitCredits) return { reason: 'RESERVATION_AMOUNT_MISMATCH', repaired: false };
            if (reservation.status !== 'settled') {
              await client.query(`UPDATE credit_reservations SET status = 'settled', updated_at = now() WHERE ${kind}_job_id = $1`, [job.id]);
              return { repaired: true };
            }
            return { repaired: false };
          }
          if (current.status === 'settling') return { reason: 'SETTLEMENT_IN_PROGRESS', repaired: false };
          if (charge) return { reason: 'NONTERMINAL_JOB_CHARGED', repaired: false };
          if (current.unitCredits === null) return { reason: 'JOB_PRICE_MISSING', repaired: false };
          const amount = current.unitCredits * current.requestedCount;
          if (reservation?.status === 'reserved') {
            return reservation.amount === amount ? { repaired: false } : { reason: 'RESERVATION_AMOUNT_MISMATCH', repaired: false };
          }
          const balance = (await client.query<{ available: string }>(
            `SELECT (COALESCE((SELECT SUM(amount) FROM credit_transactions WHERE user_id = $1), 0) -
              COALESCE((SELECT SUM(reserved_amount) FROM credit_reservations WHERE user_id = $1 AND status = 'reserved'), 0))::text AS available`, [current.userId],
          )).rows[0];
          if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647 || Number(balance?.available ?? 0) < amount) {
            return { reason: 'RESERVATION_RESTORE_INSUFFICIENT_CREDITS', repaired: false };
          }
          if (reservation) {
            await client.query(`UPDATE credit_reservations SET status = 'reserved', reserved_amount = $2, updated_at = now() WHERE ${kind}_job_id = $1`, [job.id, amount]);
          } else {
            await reserveJobCredits(client, job, current.userId, amount);
          }
          return { repaired: true };
        });
        report.checked++;
        if (outcome.repaired) report.repaired++;
        if (outcome.reason) report.issues.push({ ...job, reason: outcome.reason });
        if (candidate.stale && ['pending', 'queued'].includes(candidate.status)) {
          const queued = await queues[kind].getJob(job.id);
          const state = await queued?.getState();
          if (state === 'failed' || state === 'completed') {
            if (kind === 'theme') await settleThemeJob(database, job.id);
            else await settleArtworkJob(database, job.id);
          } else if (!queued) {
            await queues[kind].add(kind === 'theme' ? THEME_TASK_NAME : ARTWORK_TASK_NAME, { jobId: job.id }, {
              jobId: job.id, attempts: 3, backoff: { type: 'exponential', delay: 2000 },
            });
          }
        }
      } catch {
        report.issues.push({ ...job, reason: 'RECONCILIATION_FAILED' });
      }
    }
  }
  return report;
}
