import type pg from 'pg';
import { digest } from '../../../lib/digest.js';
import { domainError as projectError } from '../../../lib/errors.js';
import type { createStorage } from '../../../infra/storage.js';
import type { ThemeInput } from '../theme/service.js';
import { ARTWORK_QUALITY, DIRECTIONS, type ArtworkContext, type ArtworkSnapshot, type Database, type Direction, type JobSummary } from './types.js';

export function artworkHash(context: ArtworkContext): string {
  return digest([context.schemeCode, context.themeJobId, context.resultId, context.selectionRevision]);
}
export function artworkCredits(job: Pick<JobSummary, 'status' | 'unitCredits' | 'usableCount'>) {
  const price = job.unitCredits ?? 0;
  const terminal = ['succeeded', 'partially_succeeded', 'failed'].includes(job.status);
  return { status: terminal ? job.usableCount ? 'settled' : 'released' : 'reserved', reservedCredits: price * 4,
    heldCredits: terminal ? 0 : price * 4, chargedCredits: terminal ? price * job.usableCount : 0,
    releasedCredits: terminal ? price * (4 - job.usableCount) : 0 };
}
export function receipt(job: JobSummary, reusedRequest: boolean) {
  return { jobId: job.id, artworkJobId: job.id, status: job.status, deliveryStatus: job.deliveryStatus, reusedRequest,
    credits: artworkCredits(job), pollAfterMs: ['succeeded', 'partially_succeeded', 'failed'].includes(job.status) ? null : 2000 };
}
export async function assertThemeSelection(database: Database, userId: string, context: ArtworkContext, lock = false) {
  const job = (await database.query<{ input: ThemeInput; sourceAssetId: string; versionId: string; objectKey: string; checksum: string }>(
    `SELECT j.input,r.asset_id AS "sourceAssetId",v.id AS "versionId",v.object_key AS "objectKey",v.checksum
     FROM theme_jobs j JOIN theme_job_results r ON r.job_id=j.id AND r.id=j.selected_result_id
     JOIN scheme_assets a ON a.id=r.asset_id AND a.is_active
       AND a.source='theme_generation' AND a.visibility='private' AND a.owner_user_id=j.user_id
     JOIN asset_versions v ON v.id=r.asset_version_id AND v.asset_id=r.asset_id
     JOIN schemes s ON s.code=j.scheme_code AND s.id=a.scheme_id AND s.publish_status='published'
     WHERE j.id=$1 AND j.user_id=$2 AND j.scheme_code=$3 AND r.id=$4 AND j.selection_revision=$5
       AND j.status IN ('succeeded','partially_succeeded') AND v.byte_size>0${lock ? ' FOR UPDATE OF j' : ''}`,
    [context.themeJobId, userId, context.schemeCode, context.resultId, context.selectionRevision],
  )).rows[0];
  if (!job) throw projectError('THEME_SELECTION_CHANGED');
  return job;
}

// The asset version fields match the project asset snapshot structurally, so projects can freeze these files as-is.
export interface ArtworkFile {
  assetId: string; versionId: string; type: string; name: string; revision: number; objectKey: string;
  checksum: string; filename: string; mimeType: string; metadata: Record<string, unknown>;
  direction: Direction; width: number; height: number; byteSize: number;
}
export async function artworkFiles(database: Database, jobId: string): Promise<ArtworkFile[]> {
  return (await database.query<ArtworkFile>(`SELECT r.direction,r.width,r.height,a.id AS "assetId",a.type,a.name,a.revision,a.metadata,
    v.id AS "versionId",v.object_key AS "objectKey",v.checksum,v.original_filename AS filename,v.mime_type AS "mimeType",v.byte_size::float8 AS "byteSize"
    FROM artwork_job_results r JOIN artwork_jobs j ON j.id=r.job_id
    JOIN scheme_assets a ON a.id=r.asset_id
      AND a.source='artwork_generation' AND a.visibility='private' AND a.owner_user_id=j.user_id
    JOIN asset_versions v ON v.id=r.asset_version_id AND v.asset_id=r.asset_id
    WHERE r.job_id=$1 AND r.direction IS NOT NULL ORDER BY r.ordinal`, [jobId])).rows;
}
export function completeArtworkFiles(files: ArtworkFile[]): boolean {
  return files.length === 4 && DIRECTIONS.every(d => files.filter(f => f.direction === d).length === 1) && files.every(f =>
    f.mimeType === 'image/png' && f.byteSize > 0 && f.byteSize <= ARTWORK_QUALITY.maxBytes &&
    Math.max(f.width, f.height) >= ARTWORK_QUALITY.minLongEdge && Math.min(f.width, f.height) >= ARTWORK_QUALITY.minShortEdge &&
    f.width * f.height <= ARTWORK_QUALITY.maxPixels && /^[a-f\d]{64}$/i.test(f.checksum));
}
export async function ownedArtworkJob(database: Database, userId: string, jobId: string) {
  const job = (await database.query<JobSummary & { schemeCode: string; themeJobId: string; resultId: string; selectionRevision: number; snapshot: ArtworkSnapshot; phase: string | null }>(
    `SELECT id,status,delivery_status AS "deliveryStatus",unit_credits AS "unitCredits",usable_count AS "usableCount",scheme_code AS "schemeCode",
      theme_job_id AS "themeJobId",theme_result_id AS "resultId",theme_selection_revision AS "selectionRevision",generation_snapshot AS snapshot,phase
     FROM artwork_jobs WHERE id=$1 AND user_id=$2`, [jobId, userId])).rows[0];
  if (!job) throw projectError('ARTWORK_NOT_FOUND', 404);
  return job;
}
export async function getArtworkJob(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'signDownload'>, userId: string, jobId: string) {
  const job = await ownedArtworkJob(pool, userId, jobId);
  const files = await artworkFiles(pool, jobId);
  const states = (await pool.query<{ direction: Direction; status: string; reason: string | null }>('SELECT direction,status,reason FROM artwork_job_directions WHERE job_id=$1', [jobId])).rows;
  const directions = await Promise.all(DIRECTIONS.map(async direction => {
    const file = files.find(f => f.direction === direction);
    const state = states.find(s => s.direction === direction);
    return { direction, status: state?.status ?? 'failed', reason: state?.reason ?? null,
      ...(file ? { assetId: file.assetId, width: file.width, height: file.height, byteSize: file.byteSize, filename: file.filename,
        previewUrl: await storage.signDownload(file.objectKey, 300) } : {}) };
  }));
  return { ...receipt(job, false), schemeCode: job.schemeCode, phase: job.phase,
    themeSelection: { themeJobId: job.themeJobId, resultId: job.resultId, selectionRevision: job.selectionRevision },
    referencePreviewUrl: job.snapshot ? await storage.signDownload(job.snapshot.source.objectKey, 300) : null,
    directions, missingDirections: DIRECTIONS.filter(d => !files.some(f => f.direction === d)), mappingStatus: 'unresolved', quality: ARTWORK_QUALITY };
}
export async function readyArtworkFiles(database: Database, userId: string, jobId: string, context: ArtworkContext) {
  const job = await ownedArtworkJob(database, userId, jobId);
  if (artworkHash(job) !== artworkHash(context)) throw projectError('ARTWORK_CONTEXT_MISMATCH');
  const files = await artworkFiles(database, jobId);
  if (job.deliveryStatus !== 'ready' || !completeArtworkFiles(files)) throw projectError('ARTWORK_INCOMPLETE');
  return files;
}

export async function listArtworkJobs(pool: pg.Pool, userId: string, context: ArtworkContext) {
  await assertThemeSelection(pool, userId, context);
  const rows = (await pool.query<{ jobId: string; status: string; deliveryStatus: string }>(
    `SELECT id AS "jobId",status,delivery_status AS "deliveryStatus" FROM artwork_jobs
     WHERE user_id=$1 AND scheme_code=$2 AND theme_job_id=$3 AND theme_result_id=$4 AND theme_selection_revision=$5 ORDER BY created_at DESC,id DESC`,
    [userId, context.schemeCode, context.themeJobId, context.resultId, context.selectionRevision])).rows;
  return { items: rows };
}

/** SSE 重连时补发的当前状态；不属于该用户的任务视为不存在 */
export async function artworkJobStatus(pool: Pick<pg.Pool, 'query'>, userId: string, jobId: string): Promise<{ status: string; phase: string | null; deliveryStatus: string }> {
  const job = (await pool.query<{ status: string; phase: string | null; deliveryStatus: string }>(
    'SELECT status, phase, delivery_status AS "deliveryStatus" FROM artwork_jobs WHERE id = $1 AND user_id = $2', [jobId, userId],
  )).rows[0];
  if (!job) throw new Error('Artwork job not found');
  return job;
}
