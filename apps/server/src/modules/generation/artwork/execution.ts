import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import { downloadGeneratedImage, imageAdapter } from '../../../infra/ai/catalog.js';
import { activeAiModels } from '../../../infra/ai/config.js';
import { ImageGenerationError, normalizeGeneratedImage } from '../../../infra/ai/image.js';
import type { ActiveAiModel } from '../../../infra/ai/types.js';
import { transaction } from '../../../infra/database.js';
import type { createStorage } from '../../../infra/storage.js';
import { ARTWORK_QUALITY, DIRECTIONS, DIRECTION_LABELS, artworkFiles, completeArtworkFiles, type ArtworkSnapshot, type Direction } from './service.js';
import { lockCreditJob, releaseJobCredits, settleJobCredits, terminalCreditJob } from '../../credits/service.js';
import { claimGeneration, publishGeneration, refreshGeneration } from '../execution.js';
import { logger } from '../../../infra/logger.js';

type ArtworkConfig = Pick<Config, 'aiModelEncryptionKey' | 's3'>;
export type PublishArtworkEvent = (jobId: string, event: unknown) => Promise<void>;
type ArtworkJob = {
  requestId: string | null;
  schemeCode: string;
  unitCredits: number | null;
  userId: string;
  status: string;
  snapshot: ArtworkSnapshot | null;
};

export async function normalizeArtworkImage(bytes: Buffer) {
  try {
    return await normalizeGeneratedImage(bytes, ARTWORK_QUALITY.minLongEdge, ARTWORK_QUALITY.minShortEdge);
  } catch (error) {
    if (error instanceof ImageGenerationError) throw new Error(error.code.replace(/^IMAGE_/, 'ARTWORK_'));
    throw error;
  }
}

export async function processArtworkJob(
  database: pg.Pool,
  jobId: string,
  config: ArtworkConfig,
  storage?: ReturnType<typeof createStorage>,
  publish: PublishArtworkEvent = async () => {},
): Promise<void> {
  if (!storage) throw new Error('Artwork storage required');
  const claim = await claimGeneration(database, { kind: 'artwork', id: jobId });
  if (!claim) return;
  const { lease, deadline } = claim;
  try {
    const job = (await database.query<ArtworkJob>(`SELECT request_id AS "requestId", scheme_code AS "schemeCode", user_id AS "userId",
      unit_credits AS "unitCredits", generation_snapshot AS snapshot, status FROM artwork_jobs WHERE id = $1`, [jobId])).rows[0];
    if (!job) throw new Error('Artwork job not found');
    const log = logger.child({ jobKind: 'artwork', jobId, requestId: job.requestId });
    if (deadline.getTime() <= Date.now()) { await settleArtworkJob(database, jobId, lease, publish); return; }
    await publishGeneration(publish, jobId, { status: 'running' });
    if (!job.snapshot) {
      await database.query(`UPDATE artwork_job_directions SET status='failed',reason='LEGACY_CONTEXT_UNAVAILABLE' WHERE job_id=$1 AND status<>'succeeded'`, [jobId]);
    } else {
      const snapshot = job.snapshot;
      let model: ActiveAiModel | undefined;
      let modelsLoaded = false;
      let reference: Buffer | undefined;
      for (const [index, direction] of DIRECTIONS.entries()) {
        await refreshGeneration(database, { kind: 'artwork', id: jobId }, lease, `generating_${direction}`);
        await publishGeneration(publish, jobId, { status: 'running', phase: `generating_${direction}` });
        const state = (await database.query<{ status: string; url: string | null }>('SELECT status,generated_url AS url FROM artwork_job_directions WHERE job_id=$1 AND direction=$2', [jobId, direction])).rows[0];
        if (!state || state.status === 'succeeded' || state.status === 'failed') continue;
        if (state.status === 'submitting') {
          await failDirection(database, jobId, lease, direction, 'PROVIDER_OUTCOME_UNKNOWN', publish);
          continue;
        }
        let url = state.url;
        if (!url) {
          if (!modelsLoaded) {
            model = (await activeAiModels(database, 'artwork', config.aiModelEncryptionKey)).find(m =>
              m.provider === snapshot.model.provider && m.model === snapshot.model.model && m.revision === snapshot.model.revision);
            modelsLoaded = true;
          }
          if (!model) { await failDirection(database, jobId, lease, direction, 'MODEL_UNAVAILABLE', publish); continue; }
          if (!reference) {
            reference = await storage.getBuffer(snapshot.source.objectKey, ARTWORK_QUALITY.maxBytes);
            if (createHash('sha256').update(reference).digest('hex') !== snapshot.source.checksum) throw new Error('Artwork reference integrity mismatch');
            await normalizeGeneratedImage(reference);
          }
          await updateDirection(database, jobId, lease, direction, 'submitting');
          await publishGeneration(publish, jobId, { direction, status: 'submitting' });
          let providerRequestId: string | undefined;
          try {
            const prompt = snapshot.directionPrompts?.[direction] ?? snapshot.prompt.replaceAll('{{directionLabel}}', DIRECTION_LABELS[direction]);
            const generated = await imageAdapter(model).edit(model, { reference, prompt, count: 1, deadline, onProviderRequest: async id => {
              providerRequestId = id;
              await database.query('UPDATE artwork_job_directions SET provider_request_id=$3 WHERE job_id=$1 AND direction=$2', [jobId, direction, id]);
            } });
            url = generated[0] ?? null;
            if (!url) throw new ImageGenerationError('PROVIDER_NO_IMAGE');
            log.info({ direction, provider: model.provider, providerRequestId }, 'Artwork provider request completed');
          } catch (error) {
            const reason = error instanceof ImageGenerationError ? error.code : 'PROVIDER_OUTCOME_UNKNOWN';
            log.warn({ direction, provider: model.provider, providerRequestId, code: reason }, 'Artwork provider request failed');
            if (error instanceof ImageGenerationError && error.retryable && !error.outcomeUnknown) {
              await updateDirection(database, jobId, lease, direction, 'pending');
              throw error;
            }
            await failDirection(database, jobId, lease, direction, reason, publish);
            continue;
          }
          await updateDirection(database, jobId, lease, direction, 'generated', url);
          await publishGeneration(publish, jobId, { direction, status: 'generated' });
        }
        let image: Awaited<ReturnType<typeof normalizeArtworkImage>>;
        try { image = await normalizeArtworkImage(await downloadGeneratedImage(url, deadline)); }
        catch (error) {
          if (error instanceof ImageGenerationError && error.retryable) throw error;
          const reason = error instanceof ImageGenerationError ? error.code.replace(/^IMAGE_/, 'ARTWORK_') :
            error instanceof Error && error.message.startsWith('ARTWORK_') ? error.message : 'ARTWORK_IMAGE_INVALID';
          await failDirection(database, jobId, lease, direction, reason, publish);
          continue;
        }
        const assetId = randomUUID(); const versionId = randomUUID();
        await refreshGeneration(database, { kind: 'artwork', id: jobId }, lease, 'result_persisting');
        const objectKey = `artwork-results/${jobId}/${direction}.png`;
        const checksum = createHash('sha256').update(image.bytes).digest('hex');
        await storage.putBuffer(objectKey, image.bytes, 'image/png');
        await transaction(database, async client => {
          const current = (await client.query("SELECT id FROM artwork_jobs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE", [jobId, lease])).rows[0];
          if (!current) throw new Error('Artwork lease lost');
          await client.query(`INSERT INTO scheme_assets(id,scheme_id,type,name,sort_order,metadata,source,owner_user_id,visibility)
            SELECT $1,id,'artwork',$2,$3,$4,'artwork_generation',$6,'private' FROM schemes WHERE code=$5`, [assetId, `${DIRECTION_LABELS[direction]}方向底图`, index,
              JSON.stringify({ artworkJobId: jobId, direction, mappingStatus: 'unresolved', physicalDimensions: 'unverified' }), job.schemeCode, job.userId]);
          await client.query(`INSERT INTO asset_versions(id,asset_id,object_key,original_filename,mime_type,byte_size,checksum,width_px,height_px)
            VALUES($1,$2,$3,$4,'image/png',$5,$6,$7,$8)`, [versionId, assetId, objectKey, `${direction}.png`, image.bytes.length, checksum, image.width, image.height]);
          await client.query(`INSERT INTO artwork_job_results(job_id,ordinal,asset_id,asset_version_id,direction,width,height) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [jobId, index + 1, assetId, versionId, direction, image.width, image.height]);
          await client.query("UPDATE artwork_job_directions SET status='succeeded',generated_url=NULL,reason=NULL,updated_at=now() WHERE job_id=$1 AND direction=$2", [jobId, direction]);
        });
        await publishGeneration(publish, jobId, { direction, status: 'succeeded' });
      }
    }
    await refreshGeneration(database, { kind: 'artwork', id: jobId }, lease, 'credit_settling');
    await settleArtworkJob(database, jobId, lease, publish);
  } finally {
    await database.query('UPDATE artwork_jobs SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2', [jobId, lease]);
  }
}

async function updateDirection(database: pg.Pool, jobId: string, lease: string, direction: Direction, status: string, url: string | null = null, reason: string | null = null) {
  await transaction(database, async client => {
    const owner = await client.query("SELECT id FROM artwork_jobs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE", [jobId, lease]);
    if (!owner.rows[0]) throw new ImageGenerationError('GENERATION_LEASE_LOST_OR_EXPIRED');
    await client.query('UPDATE artwork_job_directions SET status=$3,generated_url=$4,reason=$5,updated_at=now() WHERE job_id=$1 AND direction=$2', [jobId, direction, status, url, reason]);
  });
}

async function failDirection(database: pg.Pool, jobId: string, lease: string, direction: Direction, reason: string, publish: PublishArtworkEvent) {
  await updateDirection(database, jobId, lease, direction, 'failed', null, reason);
  await publishGeneration(publish, jobId, { direction, status: 'failed', reason });
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
