import type pg from 'pg';
import { ImageGenerationError } from '../../../infra/ai/image.js';
import { transaction } from '../../../infra/database.js';
import { CreditInvariantError, terminalCreditJob } from '../../credits/service.js';
import { jobLedger, lockCreditJob } from '../credit-jobs.js';
import { claimGeneration, publishGeneration, refreshGeneration } from '../execution.js';
import { logger } from '../../../infra/logger.js';
import { generateTheme } from './attempts.js';
import { persistThemeResults } from './results.js';
import type { PublishThemeEvent, ThemeConfig, ThemeJob, ThemeStorage } from './types.js';

async function loadThemeJob(database: pg.Pool, jobId: string) {
  const job = (await database.query<ThemeJob>(`SELECT request_id AS "requestId", requested_count AS "requestedCount", source_asset_id AS "sourceAssetId", scheme_code AS "schemeCode", input,
    unit_credits AS "unitCredits", user_id AS "userId", status, generation_snapshot AS snapshot FROM theme_jobs WHERE id = $1`, [jobId])).rows[0];
  if (!job) throw new Error('Theme job not found');
  return job;
}

export async function settleThemeJob(database: pg.Pool, jobId: string, lease?: string, publish: PublishThemeEvent = async () => {}) {
  const event = await transaction(database, async client => {
    const job = await lockCreditJob(client, { kind: 'theme', id: jobId });
    if (!job || terminalCreditJob(job.status)) return;
    if (lease ? job.leaseToken !== lease : job.leaseUntil && new Date(job.leaseUntil).getTime() > Date.now()) throw new ImageGenerationError('GENERATION_LEASE_BUSY', true);
    const results = await client.query<{ resultId: string; previewUrl: string }>('SELECT id AS "resultId", preview_url AS "previewUrl" FROM theme_job_results WHERE job_id = $1 ORDER BY ordinal', [jobId]);
    const usable = results.rows.length;
    await client.query(`UPDATE theme_job_provider_attempts SET status = 'unknown', reason = COALESCE(reason, 'PROVIDER_OUTCOME_UNKNOWN'),
      updated_at = now() WHERE job_id = $1 AND status = 'submitting'`, [jobId]);
    if (usable) {
      if (job.unitCredits === null) throw new CreditInvariantError('CREDIT_JOB_PRICE_MISSING', 'Theme job price missing', { kind: 'theme', id: jobId });
      await jobLedger.settle(client, { kind: 'theme', id: jobId }, usable * job.unitCredits);
    }
    const status = usable === job.requestedCount ? 'succeeded' : usable ? 'partially_succeeded' : 'failed';
    await client.query('UPDATE theme_jobs SET status = $1, phase = NULL, usable_count = $2, lease_token = NULL, lease_until = NULL, updated_at = now() WHERE id = $3', [status, usable, jobId]);
    if (!usable) await jobLedger.release(client, { kind: 'theme', id: jobId });
    return { status, results: results.rows };
  });
  if (event) await publishGeneration(publish, jobId, event);
}

/**
 * 主题任务执行流程：认领租约 → 生图（供应商尝试与恢复）→ 结果入库 → 积分结算。
 * 每个阶段独立可重入，崩溃或重试后从落库状态继续。
 */
export async function processThemeJob(database: pg.Pool, jobId: string, config: ThemeConfig,
  storage?: ThemeStorage, publish: PublishThemeEvent = async () => {}, draining?: AbortSignal): Promise<void> {
  if (!storage) throw new Error('Theme storage required');
  const claim = await claimGeneration(database, { kind: 'theme', id: jobId });
  if (!claim) return;
  const { lease, deadline } = claim;
  try {
    const job = await loadThemeJob(database, jobId);
    const log = logger.child({ jobKind: 'theme', jobId, requestId: job.requestId });
    if (deadline.getTime() <= Date.now()) { await settleThemeJob(database, jobId, lease, publish); return; }
    await publishGeneration(publish, jobId, { status: 'running' });
    const run = { database, jobId, job, lease, deadline, config, storage, log, draining };
    await generateTheme(run);
    await persistThemeResults(run);
    await refreshGeneration(database, { kind: 'theme', id: jobId }, lease, 'credit_settling');
    await settleThemeJob(database, jobId, lease, publish);
  } finally {
    await database.query('UPDATE theme_jobs SET lease_token = NULL, lease_until = NULL WHERE id = $1 AND lease_token = $2', [jobId, lease]);
  }
}
