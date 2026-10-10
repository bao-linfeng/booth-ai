import type pg from 'pg';
import { createJobLedger, lockCreditUser, type CreditJob, type LockedCreditJob } from '../credits/service.js';

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

// Generation owns the job tables and credits owns the ledger; settling a job combines both inside one transaction.
export const jobLedger = createJobLedger(lockCreditJob);
