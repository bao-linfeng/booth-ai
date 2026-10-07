import type pg from 'pg';

export type CreditJob = { kind: 'theme' | 'artwork'; id: string };
export type LockedCreditJob = {
  userId: string; status: string; unitCredits: number | null; requestedCount: number;
  usableCount: number; cacheHit: boolean; leaseToken: string | null; leaseUntil: Date | null;
};
export type JobReservation = { userId: string; amount: number; status: 'reserved' | 'settled' | 'released' };
export type JobCharge = { userId: string; amount: number; kind: string };
export const terminalCreditJob = (status: string) => ['succeeded', 'partially_succeeded', 'failed'].includes(status);

/**
 * Ledger invariant violations. The stable `code` is what worker and API logs record (see `errorCode`),
 * so a failed settlement can be traced to the broken rule and job without logging messages.
 */
export type CreditInvariantCode =
  | 'CREDIT_AMOUNT_INVALID'
  | 'CREDIT_JOB_PRICE_MISSING'
  | 'CREDIT_RESERVATION_INVALID_JOB'
  | 'CREDIT_RESERVATION_CONFLICT'
  | 'CREDIT_SETTLEMENT_INVALID_JOB'
  | 'CREDIT_RESERVATION_INACTIVE'
  | 'CREDIT_CHARGE_CONFLICT'
  | 'CREDIT_RELEASE_NOT_FAILED'
  | 'CREDIT_RELEASE_CHARGED';

export class CreditInvariantError extends Error {
  override readonly name = 'CreditInvariantError';
  constructor(readonly code: CreditInvariantCode, message: string, readonly job?: CreditJob) {
    super(job ? `${message} (${job.kind}_job ${job.id})` : message);
  }
}

const validCreditAmount = (amount: number) => Number.isSafeInteger(amount) && amount > 0 && amount <= 2147483647;

export async function lockCreditUser(client: pg.PoolClient, userId: string): Promise<void> {
  const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!user.rows[0]) throw Object.assign(new Error('User not found'), { statusCode: 404, reason: 'USER_NOT_FOUND' });
}

/** Locks the owning user before the job row, so every ledger writer acquires locks in the same order. */
export async function lockCreditJob(client: pg.PoolClient, job: CreditJob): Promise<LockedCreditJob | undefined> {
  const peek = (await client.query<{ userId: string }>(`SELECT user_id AS "userId" FROM ${job.kind}_jobs WHERE id = $1`, [job.id])).rows[0];
  if (!peek) return;
  await lockCreditUser(client, peek.userId);
  return (await client.query<LockedCreditJob>(
    `SELECT user_id AS "userId", status, unit_credits AS "unitCredits", requested_count AS "requestedCount",
      usable_count AS "usableCount", ${job.kind === 'theme' ? 'cache_hit' : 'false'} AS "cacheHit",
      lease_token AS "leaseToken", lease_until AS "leaseUntil"
    FROM ${job.kind}_jobs WHERE id = $1 FOR UPDATE`, [job.id])).rows[0];
}

export async function lockJobReservation(client: pg.PoolClient, job: CreditJob): Promise<JobReservation | undefined> {
  return (await client.query<JobReservation>(
    `SELECT user_id AS "userId", reserved_amount AS amount, status FROM credit_reservations WHERE ${job.kind}_job_id = $1 FOR UPDATE`, [job.id],
  )).rows[0];
}

/** A job has at most one consume transaction (unique index per job column). */
export async function findJobCharge(client: pg.PoolClient, job: CreditJob): Promise<JobCharge | undefined> {
  return (await client.query<JobCharge>(
    `SELECT user_id AS "userId", amount, kind FROM credit_transactions WHERE ${job.kind}_job_id = $1`, [job.id],
  )).rows[0];
}

/** Ledger balance minus active holds; callers must hold the user lock for the result to stay valid. */
export async function availableCredits(client: pg.PoolClient, userId: string): Promise<number> {
  const result = (await client.query<{ availableBalance: string }>(
    `SELECT (COALESCE((SELECT SUM(amount) FROM credit_transactions WHERE user_id = $1), 0) -
      COALESCE((SELECT SUM(reserved_amount) FROM credit_reservations WHERE user_id = $1 AND status = 'reserved'), 0))::text AS "availableBalance"`, [userId],
  )).rows[0];
  return Number(result?.availableBalance ?? 0);
}

async function setReservationStatus(client: pg.PoolClient, job: CreditJob, status: JobReservation['status']) {
  await client.query(`UPDATE credit_reservations SET status = $2, updated_at = now() WHERE ${job.kind}_job_id = $1`, [job.id, status]);
}

/** Holds the full price of an active job. Replaying with identical parameters is a no-op. */
export async function reserveJobCredits(client: pg.PoolClient, job: CreditJob, userId: string, amount: number): Promise<void> {
  if (!validCreditAmount(amount)) throw new CreditInvariantError('CREDIT_AMOUNT_INVALID', 'Invalid credit reservation amount', job);
  const current = await lockCreditJob(client, job);
  if (!current || current.userId !== userId || terminalCreditJob(current.status) || current.cacheHit ||
      current.unitCredits === null || current.unitCredits * current.requestedCount !== amount) {
    throw new CreditInvariantError('CREDIT_RESERVATION_INVALID_JOB', 'Invalid credit reservation job', job);
  }
  const existing = await lockJobReservation(client, job);
  if (existing) {
    if (existing.userId !== userId || existing.amount !== amount || existing.status !== 'reserved') {
      throw new CreditInvariantError('CREDIT_RESERVATION_CONFLICT', 'Credit reservation conflict', job);
    }
    return;
  }
  if (await availableCredits(client, userId) < amount) {
    throw Object.assign(new Error('Insufficient credits for this request'), { statusCode: 402, reason: 'INSUFFICIENT_CREDITS' });
  }
  await client.query(`INSERT INTO credit_reservations (user_id, ${job.kind}_job_id, reserved_amount) VALUES ($1, $2, $3)`, [userId, job.id, amount]);
}

/**
 * Converts the hold into a single consume transaction for the usable results; `amount = 0` releases it instead.
 * Replaying after a lost COMMIT finds the same charge and only re-settles the reservation.
 */
export async function settleJobCredits(client: pg.PoolClient, job: CreditJob, amount: number): Promise<void> {
  const current = await lockCreditJob(client, job);
  if (!current || current.cacheHit || terminalCreditJob(current.status)) {
    throw new CreditInvariantError('CREDIT_SETTLEMENT_INVALID_JOB', 'Invalid credit settlement job', job);
  }
  if (!Number.isSafeInteger(amount) || amount < 0 || current.unitCredits === null ||
      amount > current.unitCredits * current.requestedCount) throw new CreditInvariantError('CREDIT_AMOUNT_INVALID', 'Invalid credit charge amount', job);
  const reservation = await lockJobReservation(client, job);
  if (!reservation || reservation.userId !== current.userId || reservation.status !== 'reserved' ||
      reservation.amount !== current.unitCredits * current.requestedCount || amount > reservation.amount) {
    throw new CreditInvariantError('CREDIT_RESERVATION_INACTIVE', 'Active credit reservation required', job);
  }
  const charge = await findJobCharge(client, job);
  if (amount === 0) {
    if (charge) throw new CreditInvariantError('CREDIT_CHARGE_CONFLICT', 'Zero-usable job cannot have a credit charge', job);
    await setReservationStatus(client, job, 'released');
    return;
  }
  if (charge) {
    if (charge.userId !== current.userId || charge.amount !== -amount || charge.kind !== `${job.kind}_consume`) {
      throw new CreditInvariantError('CREDIT_CHARGE_CONFLICT', 'Credit charge conflict', job);
    }
  } else {
    await client.query(`INSERT INTO credit_transactions (user_id, kind, amount, note, ${job.kind}_job_id)
      VALUES ($1, '${job.kind}_consume', $2, $3, $4)`, [current.userId, -amount, `${job.kind}_job:${job.id}`, job.id]);
  }
  await setReservationStatus(client, job, 'settled');
}

/** Returns the hold of a failed, uncharged job. Idempotent. */
export async function releaseJobCredits(client: pg.PoolClient, job: CreditJob): Promise<void> {
  const current = await lockCreditJob(client, job);
  if (!current || current.status !== 'failed') throw new CreditInvariantError('CREDIT_RELEASE_NOT_FAILED', 'Only failed jobs can release credits', job);
  if (await findJobCharge(client, job)) throw new CreditInvariantError('CREDIT_RELEASE_CHARGED', 'Charged job cannot release credits', job);
  await client.query(`UPDATE credit_reservations SET status = 'released', updated_at = now()
    WHERE ${job.kind}_job_id = $1 AND status <> 'released'`, [job.id]);
}
