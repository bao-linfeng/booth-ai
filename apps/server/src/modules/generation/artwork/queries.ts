import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';
import { projectError } from '../../projects/domain.js';
import { artworkFiles, assertThemeSelection, ownedArtworkJob, type ArtworkContext } from './service.js';

export async function listArtworkJobs(pool: pg.Pool, userId: string, context: ArtworkContext) {
  await assertThemeSelection(pool, userId, context);
  const rows = (await pool.query<{ jobId: string; status: string; deliveryStatus: string }>(
    `SELECT id AS "jobId",status,delivery_status AS "deliveryStatus" FROM artwork_jobs
     WHERE user_id=$1 AND scheme_code=$2 AND theme_job_id=$3 AND theme_result_id=$4 AND theme_selection_revision=$5 ORDER BY created_at DESC,id DESC`,
    [userId, context.schemeCode, context.themeJobId, context.resultId, context.selectionRevision])).rows;
  return { items: rows };
}

export async function downloadArtworkAsset(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'getBuffer'>,
  userId: string, jobId: string, assetId: string) {
  await ownedArtworkJob(pool, userId, jobId);
  const file = (await artworkFiles(pool, jobId)).find(f => f.assetId === assetId);
  if (!file) throw projectError('ARTWORK_NOT_FOUND', 404);
  let bytes: Buffer;
  try {
    bytes = await storage.getBuffer(file.objectKey, file.byteSize);
    if (bytes.length !== file.byteSize || createHash('sha256').update(bytes).digest('hex') !== file.checksum) throw new Error('Artwork integrity mismatch');
  } catch { throw projectError('ARTWORK_STORAGE_UNAVAILABLE', 503); }
  return { bytes, filename: `${file.direction}.png` };
}
