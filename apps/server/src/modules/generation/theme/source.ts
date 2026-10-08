import { createHash } from 'node:crypto';
import type pg from 'pg';
import sharp from 'sharp';
import { IMAGE_LIMITS, ImageGenerationError, normalizeGeneratedImage } from '../../../infra/ai/image.js';
import { getActivePromptTemplate } from '../../prompts/service.js';
import { buildThemePrompt } from './prompt.js';
import { normalizeThemeInput } from './service.js';
import type { ThemeJob, ThemeStorage } from './types.js';

export type ThemeSource = { reference: Buffer; mask: Buffer | undefined };

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** 快照任务使用冻结的提示词；无快照的旧任务按当前字典与模板实时构建。 */
export async function resolveThemePrompt(database: pg.Pool, job: ThemeJob): Promise<string> {
  if (job.snapshot?.prompt !== undefined) return job.snapshot.prompt;
  const labels = await database.query<{ id: string; label: string }>('SELECT id::text AS id, item_label AS label FROM dictionary_items WHERE id IN ($1, $2)', [job.input.industryId, job.input.styleId]);
  const industry = labels.rows.find(row => row.id === job.input.industryId)?.label;
  const style = labels.rows.find(row => row.id === job.input.styleId)?.label;
  if (!industry || !style) throw new ImageGenerationError('THEME_DICTIONARY_UNAVAILABLE');
  const template = await getActivePromptTemplate(database, 'theme', job.input.industryId, job.input.styleId);
  return buildThemePrompt(normalizeThemeInput(job.input), industry, style, template?.body);
}

async function sourceObjectKey(database: pg.Pool, job: ThemeJob): Promise<string> {
  const key = job.snapshot?.source.objectKey ?? (await database.query<{ objectKey: string }>(
    `SELECT v.object_key AS "objectKey" FROM scheme_baseline_assets a
     JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.id = $1 AND a.is_active = true`, [job.sourceAssetId],
  )).rows[0]?.objectKey;
  if (!key) throw new ImageGenerationError('THEME_SOURCE_UNAVAILABLE');
  return key;
}

async function maskObjectKey(database: pg.Pool, job: ThemeJob): Promise<string | undefined> {
  if (job.snapshot) return job.snapshot.mask?.objectKey;
  return (await database.query<{ objectKey: string }>(
    `SELECT v.object_key AS "objectKey" FROM scheme_baseline_assets a
     JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.related_asset_id = $1 AND a.type = 'mask' AND a.is_active = true LIMIT 1`, [job.sourceAssetId],
  )).rows[0]?.objectKey;
}

/** 标注色（品红）区域转为透明，供供应商按“可编辑区域”处理。 */
async function toEditMask(maskImage: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(maskImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < info.width * info.height; i++) {
    data[i * 4 + 3] = data[i * 4]! > 200 && data[i * 4 + 1]! < 60 && data[i * 4 + 2]! > 200 ? 0 : 255;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function loadMask(database: pg.Pool, job: ThemeJob, storage: ThemeStorage): Promise<Buffer | undefined> {
  const key = await maskObjectKey(database, job);
  if (!key) return undefined;
  const bytes = await storage.getBuffer(key, IMAGE_LIMITS.maxBytes);
  if (job.snapshot?.mask?.checksum && sha256(bytes) !== job.snapshot.mask.checksum) {
    throw new ImageGenerationError('THEME_MASK_INTEGRITY_INVALID');
  }
  return toEditMask((await normalizeGeneratedImage(bytes)).bytes);
}

/** 读取并校验来源图与蒙版（快照任务需校验 checksum），返回供应商编辑所需输入。 */
export async function loadThemeSource(database: pg.Pool, job: ThemeJob, storage: ThemeStorage): Promise<ThemeSource> {
  const key = await sourceObjectKey(database, job);
  const reference = await storage.getBuffer(key, IMAGE_LIMITS.maxBytes);
  await normalizeGeneratedImage(reference);
  if (job.snapshot?.source.checksum && sha256(reference) !== job.snapshot.source.checksum) {
    throw new ImageGenerationError('THEME_SOURCE_INTEGRITY_INVALID');
  }
  const mask = await loadMask(database, job, storage);
  return { reference, mask };
}
