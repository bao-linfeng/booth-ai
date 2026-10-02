import type pg from 'pg';

export type CreditJob = { kind: 'theme' | 'artwork'; id: string };
export type LockedCreditJob = {
  userId: string; status: string; unitCredits: number | null; requestedCount: number;
  usableCount: number; cacheHit: boolean; leaseToken: string | null; leaseUntil: Date | null;
};
export const terminalCreditJob = (status: string) => ['succeeded', 'partially_succeeded', 'failed'].includes(status);

export async function lockCreditUser(client: pg.PoolClient, userId: string): Promise<void> {
  const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!user.rows[0]) throw Object.assign(new Error('User not found'), { statusCode: 404, reason: 'USER_NOT_FOUND' });
}

export async function lockCreditJob(client: pg.PoolClient, job: CreditJob): Promise<LockedCreditJob | undefined> {
  const owner = (await client.query<{ userId: string }>(`SELECT user_id AS "userId" FROM ${job.kind}_jobs WHERE id = $1 FOR UPDATE`, [job.id])).rows[0];
  if (!owner) return;
  await lockCreditUser(client, owner.userId);
  return (await client.query<LockedCreditJob>(
    `SELECT user_id AS "userId", status, unit_credits AS "unitCredits", requested_count AS "requestedCount",
      usable_count AS "usableCount", ${job.kind === 'theme' ? 'cache_hit' : 'false'} AS "cacheHit",
      ${job.kind === 'artwork' ? 'lease_token' : 'NULL::uuid'} AS "leaseToken",
      ${job.kind === 'artwork' ? 'lease_until' : 'NULL::timestamptz'} AS "leaseUntil"
     FROM ${job.kind}_jobs WHERE id = $1 FOR UPDATE`, [job.id],
  )).rows[0];
}

export async function reserveJobCredits(client: pg.PoolClient, job: CreditJob, userId: string, amount: number): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647) throw new Error('Invalid credit reservation amount');
  const current = await lockCreditJob(client, job);
  if (!current || current.userId !== userId || terminalCreditJob(current.status) || current.cacheHit ||
      current.unitCredits === null || current.unitCredits * current.requestedCount !== amount) throw new Error('Invalid credit reservation job');
  const existing = (await client.query<{ userId: string; amount: number; status: string }>(
    `SELECT user_id AS "userId", reserved_amount AS amount, status FROM credit_reservations WHERE ${job.kind}_job_id = $1 FOR UPDATE`, [job.id],
  )).rows[0];
  if (existing) {
    if (existing.userId !== userId || existing.amount !== amount || existing.status !== 'reserved') throw new Error('Credit reservation conflict');
    return;
  }
  const balance = (await client.query<{ availableBalance: string }>(
    `SELECT (COALESCE((SELECT SUM(amount) FROM credit_transactions WHERE user_id = $1), 0) -
      COALESCE((SELECT SUM(reserved_amount) FROM credit_reservations WHERE user_id = $1 AND status = 'reserved'), 0))::text AS "availableBalance"`, [userId],
  )).rows[0];
  if (Number(balance?.availableBalance ?? 0) < amount) {
    throw Object.assign(new Error('Insufficient credits for this request'), { statusCode: 402, reason: 'INSUFFICIENT_CREDITS' });
  }
  await client.query(`INSERT INTO credit_reservations (user_id, ${job.kind}_job_id, reserved_amount) VALUES ($1, $2, $3)`, [userId, job.id, amount]);
}

export async function settleJobCredits(client: pg.PoolClient, job: CreditJob, amount: number): Promise<void> {
  const current = await lockCreditJob(client, job);
  if (!current || current.cacheHit || terminalCreditJob(current.status)) throw new Error('Invalid credit settlement job');
  if (!Number.isSafeInteger(amount) || amount < 0 || current.unitCredits === null ||
      amount > current.unitCredits * current.requestedCount) throw new Error('Invalid credit charge amount');
  const reservation = (await client.query<{ userId: string; amount: number; status: string }>(
    `SELECT user_id AS "userId", reserved_amount AS amount, status FROM credit_reservations WHERE ${job.kind}_job_id = $1 FOR UPDATE`, [job.id],
  )).rows[0];
  if (!reservation || reservation.userId !== current.userId || reservation.status !== 'reserved' ||
      reservation.amount !== current.unitCredits * current.requestedCount || amount > reservation.amount) throw new Error('Active credit reservation required');
  const charge = (await client.query<{ userId: string; amount: number; kind: string }>(
    `SELECT user_id AS "userId", amount, kind FROM credit_transactions WHERE ${job.kind}_job_id = $1`, [job.id],
  )).rows[0];
  if (amount === 0 && charge) throw new Error('Zero-usable job cannot have a credit charge');
  if (amount === 0) {
    await client.query(`UPDATE credit_reservations SET status = 'released', updated_at = now() WHERE ${job.kind}_job_id = $1`, [job.id]);
    return;
  }
  if (charge) {
    if (charge.userId !== current.userId || charge.amount !== -amount || charge.kind !== `${job.kind}_consume`) throw new Error('Credit charge conflict');
  } else if (amount > 0) {
    await client.query(`INSERT INTO credit_transactions (user_id, kind, amount, note, ${job.kind}_job_id)
      VALUES ($1, '${job.kind}_consume', $2, $3, $4)`, [current.userId, -amount, `${job.kind}_job:${job.id}`, job.id]);
  }
  await client.query(`UPDATE credit_reservations SET status = 'settled', updated_at = now() WHERE ${job.kind}_job_id = $1`, [job.id]);
}

export async function releaseJobCredits(client: pg.PoolClient, job: CreditJob): Promise<void> {
  const current = await lockCreditJob(client, job);
  if (!current || current.status !== 'failed') throw new Error('Only failed jobs can release credits');
  const charged = await client.query(`SELECT id FROM credit_transactions WHERE ${job.kind}_job_id = $1`, [job.id]);
  if (charged.rows.length) throw new Error('Charged job cannot release credits');
  await client.query(`UPDATE credit_reservations SET status = 'released', updated_at = now()
    WHERE ${job.kind}_job_id = $1 AND status <> 'released'`, [job.id]);
}
