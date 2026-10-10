import type pg from 'pg';
import { transaction } from '../../infra/database.js';
import { errorCode } from '../../infra/logger.js';
import {
  availableCredits,
  findJobCharge,
  lockJobReservation,
  setJobReservation,
  terminalCreditJob,
  type CreditJob,
  type JobCharge,
  type JobReservation,
  type LockedCreditJob,
} from '../credits/service.js';
import { jobLedger, lockCreditJob } from './credit-jobs.js';

// Cross-module consistency check between generation jobs and the credit ledger. Job rows are written here because
// generation owns them; ledger rows only change through the credits module.

/** Unrepairable findings, persisted as `credit_issue`; the admin generation job page maps each code to a label. */
export type CreditIssueReason =
  | 'RESERVATION_OWNER_MISMATCH'
  | 'FAILED_JOB_CHARGED'
  | 'CACHED_JOB_CHARGED'
  | 'TERMINAL_RESULT_MISMATCH'
  | 'TERMINAL_CHARGE_MISMATCH'
  | 'TERMINAL_RESERVATION_MISSING'
  | 'RESERVATION_AMOUNT_MISMATCH'
  | 'SETTLEMENT_IN_PROGRESS'
  | 'NONTERMINAL_JOB_CHARGED'
  | 'JOB_PRICE_MISSING'
  | 'RESERVATION_RESTORE_INSUFFICIENT_CREDITS'
  | 'RECONCILIATION_FAILED';

/** `error` carries the stable code of the exception behind RECONCILIATION_FAILED. */
type CreditIssue = CreditJob & { reason: CreditIssueReason; error?: string };
type Verdict = { reason?: CreditIssueReason; repaired: boolean };
type LedgerState = {
  client: pg.PoolClient;
  job: CreditJob;
  current: LockedCreditJob;
  reservation: JobReservation | undefined;
  charge: JobCharge | undefined;
};

const clean: Verdict = { repaired: false };
const repaired: Verdict = { repaired: true };
const issue = (reason: CreditIssueReason): Verdict => ({ reason, repaired: false });

// Persist the latest verdict so operators can see what automatic reconciliation could not repair; a clean pass clears it.
async function recordCreditIssue(db: Pick<pg.Pool | pg.PoolClient, 'query'>, job: CreditJob, reason: CreditIssueReason | null) {
  await db.query(
    `UPDATE ${job.kind}_jobs SET credit_issue = $2::text, credit_issue_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
    WHERE id = $1 AND credit_issue IS DISTINCT FROM $2::text`,
    [job.id, reason],
  );
}

export async function reconcileJobCredits(database: pg.Pool): Promise<{ checked: number; repaired: number; issues: CreditIssue[] }> {
  const report = { checked: 0, repaired: 0, issues: [] as CreditIssue[] };
  for (const kind of ['theme', 'artwork'] as const) {
    const jobs = (
      await database.query<{ id: string }>(
        `SELECT id FROM ${kind}_jobs
       WHERE credit_checked_at IS NULL OR credit_checked_at < now() - interval '1 minute'
       ORDER BY credit_checked_at NULLS FIRST, id LIMIT 100`,
      )
    ).rows;
    for (const candidate of jobs) {
      const job = { kind, id: candidate.id };
      try {
        const verdict = await transaction(database, async client => {
          const result = await reconcileLockedJob(client, job);
          await recordCreditIssue(client, job, result.reason ?? null);
          return result;
        });
        report.checked++;
        if (verdict.repaired) report.repaired++;
        if (verdict.reason) report.issues.push({ ...job, reason: verdict.reason });
      } catch (error) {
        report.issues.push({ ...job, reason: 'RECONCILIATION_FAILED', error: errorCode(error) });
        await recordCreditIssue(database, job, 'RECONCILIATION_FAILED').catch(() => {});
      }
    }
  }
  return report;
}

async function reconcileLockedJob(client: pg.PoolClient, job: CreditJob): Promise<Verdict> {
  const current = await lockCreditJob(client, job);
  if (!current) return clean;
  await client.query(`UPDATE ${job.kind}_jobs SET credit_checked_at = now() WHERE id = $1`, [job.id]);
  const ledger: LedgerState = {
    client,
    job,
    current,
    reservation: await lockJobReservation(client, job),
    charge: await findJobCharge(client, job),
  };
  if (ledger.reservation && ledger.reservation.userId !== current.userId) return issue('RESERVATION_OWNER_MISMATCH');
  if (current.status === 'failed') return reconcileFailedJob(ledger);
  if (current.cacheHit) return reconcileCachedJob(ledger);
  if (terminalCreditJob(current.status)) return reconcileSucceededJob(ledger);
  if (current.status === 'settling') return issue('SETTLEMENT_IN_PROGRESS');
  return reconcileActiveJob(ledger);
}

/** Failed: never charged; any remaining hold is released. */
async function reconcileFailedJob({ client, job, reservation, charge }: LedgerState): Promise<Verdict> {
  if (charge) return issue('FAILED_JOB_CHARGED');
  if (reservation && reservation.status !== 'released') {
    await jobLedger.release(client, job);
    return repaired;
  }
  return clean;
}

/** Cache hit: served for free; a stray hold is released without changing the job status. */
async function reconcileCachedJob({ client, job, reservation, charge }: LedgerState): Promise<Verdict> {
  if (charge) return issue('CACHED_JOB_CHARGED');
  if (reservation && reservation.status !== 'released') {
    await setJobReservation(client, job, 'released');
    return repaired;
  }
  return clean;
}

/**
 * (Partially) succeeded: exactly one charge of usable × price, and a settled hold for the full price.
 * A success without usable results or charge is a half-finished failure; downgrade it unless result rows contradict that.
 */
async function reconcileSucceededJob({ client, job, current, reservation, charge }: LedgerState): Promise<Verdict> {
  if (current.usableCount === 0 && !charge) {
    const results = await client.query(`SELECT 1 FROM ${job.kind}_job_results WHERE job_id = $1 LIMIT 1`, [job.id]);
    if (results.rows.length) return issue('TERMINAL_RESULT_MISMATCH');
    await client.query(
      `UPDATE ${job.kind}_jobs SET status = 'failed', phase = NULL, lease_token = NULL,
      lease_until = NULL, updated_at = now()${job.kind === 'artwork' ? ", delivery_status = 'incomplete'" : ''} WHERE id = $1`,
      [job.id],
    );
    if (job.kind === 'artwork') {
      await client.query(
        `UPDATE artwork_job_directions SET status = 'failed',
        reason = COALESCE(reason, 'PROCESSING_FAILED'), generated_url = NULL, updated_at = now() WHERE job_id = $1`,
        [job.id],
      );
    }
    await jobLedger.release(client, job);
    return repaired;
  }
  if (
    !charge ||
    current.unitCredits === null ||
    charge.amount !== -current.usableCount * current.unitCredits ||
    charge.userId !== current.userId ||
    charge.kind !== `${job.kind}_consume`
  )
    return issue('TERMINAL_CHARGE_MISMATCH');
  if (!reservation) return issue('TERMINAL_RESERVATION_MISSING');
  if (reservation.amount !== current.requestedCount * current.unitCredits) return issue('RESERVATION_AMOUNT_MISMATCH');
  if (reservation.status !== 'settled') {
    await setJobReservation(client, job, 'settled');
    return repaired;
  }
  return clean;
}

/**
 * Pending/queued/running: uncharged with an active hold for the full price. A lost hold is restored only from
 * genuinely available credits, never from money another job has since spent.
 */
async function reconcileActiveJob({ client, job, current, reservation, charge }: LedgerState): Promise<Verdict> {
  if (charge) return issue('NONTERMINAL_JOB_CHARGED');
  if (current.unitCredits === null) return issue('JOB_PRICE_MISSING');
  const amount = current.unitCredits * current.requestedCount;
  if (reservation?.status === 'reserved') return reservation.amount === amount ? clean : issue('RESERVATION_AMOUNT_MISMATCH');
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647 || (await availableCredits(client, current.userId)) < amount) {
    return issue('RESERVATION_RESTORE_INSUFFICIENT_CREDITS');
  }
  if (reservation) {
    await setJobReservation(client, job, 'reserved', amount);
  } else {
    await jobLedger.reserve(client, job, current.userId, amount);
  }
  return repaired;
}
