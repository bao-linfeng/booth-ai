import { createHash, randomUUID } from 'node:crypto';
import { downloadGeneratedImage } from '../../../infra/ai/protocols.js';
import { ImageGenerationError, normalizeGeneratedImage } from '../../../infra/ai/image.js';
import { transaction } from '../../../infra/database.js';
import { lockRunningLease, refreshGeneration } from '../execution.js';
import type { ThemeRun } from './types.js';

type NormalizedImage = Awaited<ReturnType<typeof normalizeGeneratedImage>>;

/** 下载并校验供应商返回的图片；确定性不合格返回 undefined（该序号被丢弃），可重试错误抛出。 */
async function fetchValidImage(run: ThemeRun, ordinal: number, url: string): Promise<NormalizedImage | undefined> {
  try {
    return await normalizeGeneratedImage(await downloadGeneratedImage(url, run.deadline));
  } catch (error) {
    if (!(error instanceof ImageGenerationError) || error.retryable) throw error;
    run.log.warn({ ordinal, code: error.code }, 'Theme result rejected');
    return undefined;
  }
}

/** 先上传对象，再在租约保护的事务内写入资产、版本与结果行。 */
async function storeResult(run: ThemeRun, ordinal: number, image: NormalizedImage) {
  const { database, jobId, lease, job, storage } = run;
  const assetId = randomUUID(); const versionId = randomUUID(); const resultId = randomUUID();
  const objectKey = `theme-results/${jobId}/${ordinal}.png`;
  await storage.putBuffer(objectKey, image.bytes, 'image/png');
  const previewUrl = await storage.signDownload(objectKey, 900);
  await transaction(database, async client => {
    await lockRunningLease(client, { kind: 'theme', id: run.jobId }, lease);
    await client.query(`INSERT INTO scheme_assets (id, scheme_id, type, name, sort_order, metadata, source, owner_user_id, visibility)
      SELECT $1, id, 'artwork', $2, $3, $4, 'theme_generation', $6, 'private' FROM schemes WHERE code = $5`,
    [assetId, `AI 换主题结果 ${ordinal}`, ordinal - 1, JSON.stringify({ themeJobId: jobId }), job.schemeCode, job.userId]);
    await client.query(`INSERT INTO asset_versions (id, asset_id, object_key, original_filename, mime_type, byte_size, checksum, width_px, height_px)
      VALUES ($1, $2, $3, $4, 'image/png', $5, $6, $7, $8)`,
    [versionId, assetId, objectKey, `${ordinal}.png`, image.bytes.length, createHash('sha256').update(image.bytes).digest('hex'), image.width, image.height]);
    await client.query(`INSERT INTO theme_job_results (id, job_id, ordinal, asset_id, preview_url, asset_version_id, width, height)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [resultId, jobId, ordinal, assetId, previewUrl, versionId, image.width, image.height]);
  });
}

/** 把已落库的生成 URL 逐个转成正式结果；已有结果的序号跳过，使重试幂等。 */
export async function persistThemeResults(run: ThemeRun) {
  const { database, jobId, lease } = run;
  const saved = await database.query<{ ordinal: number; url: string }>('SELECT ordinal, url FROM theme_job_generated_urls WHERE job_id = $1 ORDER BY ordinal', [jobId]);
  for (const { ordinal, url } of saved.rows) {
    const existing = await database.query('SELECT id FROM theme_job_results WHERE job_id = $1 AND ordinal = $2', [jobId, ordinal]);
    if (existing.rows[0]) continue;
    await refreshGeneration(database, { kind: 'theme', id: run.jobId }, lease, 'result_validating');
    const image = await fetchValidImage(run, ordinal, url);
    if (!image) continue;
    await refreshGeneration(database, { kind: 'theme', id: run.jobId }, lease, 'result_persisting');
    await storeResult(run, ordinal, image);
  }
}
