import type pg from 'pg';
import { ImageGenerationError } from '../../../infra/ai/image.js';
import { transaction } from '../../../infra/database.js';
import { artworkFiles, completeArtworkFiles } from './service.js';
import { lockCreditJob, releaseJobCredits, settleJobCredits, terminalCreditJob } from '../../credits/service.js';
import { claimGeneration, publishGeneration, refreshGeneration } from '../execution.js';
import { logger } from '../../../infra/logger.js';
import { generateDirections } from './directions.js';
import type { ArtworkConfig, ArtworkJob, ArtworkStorage, PublishArtworkEvent } from './types.js';

async function loadArtworkJob(database: pg.Pool, jobId: string) {
  const job = (await database.query<ArtworkJob>(`SELECT request_id AS "requestId", scheme_code AS "schemeCode", user_id AS "userId",
    unit_credits AS "unitCredits", generation_snapshot AS snapshot, status FROM artwork_jobs WHERE id = $1`, [jobId])).rows[0];
  if (!job) throw new Error('Artwork job not found');
  return job;
}

/**
 * 画稿任务执行流程：认领租约 → 四个方向依次生成并入库 → 积分结算。
 * 方向状态落库，崩溃或重试后从各方向的当前状态继续。
 */
export async function processArtworkJob(
  database: pg.Pool,
  jobId: string,
  config: ArtworkConfig,
  storage?: ArtworkStorage,
  publish: PublishArtworkEvent = async () => {},
): Promise<void> {
  if (!storage) throw new Error('Artwork storage required');
  const claim = await claimGeneration(database, { kind: 'artwork', id: jobId });
  if (!claim) return;
  const { lease, deadline } = claim;
  try {
    const job = await loadArtworkJob(database, jobId);
    const log = logger.child({ jobKind: 'artwork', jobId, requestId: job.requestId });
    if (deadline.getTime() <= Date.now()) { await settleArtworkJob(database, jobId, lease, publish); return; }
    await publishGeneration(publish, jobId, { status: 'running' });
    await generateDirections({ database, jobId, job, lease, deadline, config, storage, log, publish });
    await refreshGeneration(database, { kind: 'artwork', id: jobId }, lease, 'credit_settling');
    await settleArtworkJob(database, jobId, lease, publish);
  } finally {
    await database.query('UPDATE artwork_jobs SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2', [jobId, lease]);
  }
}

export async function settleArtworkJob(database: pg.Pool, jobId: string, lease?: string, publish: PublishArtworkEvent = async () => {}) {
  const event = await transaction(database, async client => {
    const job = await lockCreditJob(client, { kind: 'artwork', id: jobId });
    if (!job || terminalCreditJob(job.status)) return;
    if (lease ? job.leaseToken !== lease : job.leaseUntil && new Date(job.leaseUntil).getTime() > Date.now()) throw new ImageGenerationError('GENERATION_LEASE_BUSY', true);
    const files = await artworkFiles(client, jobId);
    const usable = files.length;
    if (usable && job.unitCredits === null) throw new Error('Artwork price missing');
    if (usable) await settleJobCredits(client, { kind: 'artwork', id: jobId }, usable * job.unitCredits!);
    await client.query("UPDATE artwork_job_directions SET status='failed',reason=COALESCE(reason,'PROCESSING_FAILED'),generated_url=NULL WHERE job_id=$1 AND status<>'succeeded'", [jobId]);
    const status = usable === 4 ? 'succeeded' : usable ? 'partially_succeeded' : 'failed';
    const deliveryStatus = completeArtworkFiles(files) ? 'ready' : 'incomplete';
    if (!usable) await client.query("UPDATE artwork_jobs SET status='failed',delivery_status=$2,usable_count=0,phase=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1", [jobId, deliveryStatus]);
    if (!usable) await releaseJobCredits(client, { kind: 'artwork', id: jobId });
    if (usable) await client.query(`UPDATE artwork_jobs SET status=$2,delivery_status=$3,usable_count=$4,phase=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,
      [jobId, status, deliveryStatus, usable]);
    return { status, deliveryStatus, phase: null };
  });
  if (event) await publishGeneration(publish, jobId, event);
}
