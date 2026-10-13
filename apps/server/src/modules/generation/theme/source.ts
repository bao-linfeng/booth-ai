import { createHash } from 'node:crypto';
import type pg from 'pg';
import sharp from 'sharp';
import { IMAGE_LIMITS, ImageGenerationError, normalizeGeneratedImage } from '../../../infra/ai/image.js';
import { getActivePromptTemplate } from '../../prompts/service.js';
import { toEditMask } from './mask.js';
import { buildThemePrompt } from './prompt.js';
import { normalizeThemeInput } from './service.js';
import { LEGACY_THEME_OPTIONS, type ThemePipelineOptions } from './settings.js';
import type { ThemeJob, ThemeStorage } from './types.js';

export type ThemeSource = { reference: Buffer; mask: Buffer | undefined };
export type ThemeImages = { original: Buffer; mask: Buffer | undefined };

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** 快照任务使用冻结的提示词；无快照的旧任务按当前字典与模板实时构建。 */
export async function resolveThemePrompt(database: pg.Pool, job: ThemeJob): Promise<string> {
  if (job.snapshot?.prompt !== undefined) return job.snapshot.prompt;
  const labels = await database.query<{ id: string; label: string }>(
    'SELECT id::text AS id, item_label AS label FROM dictionary_items WHERE id IN ($1, $2)',
    [job.input.industryId, job.input.styleId],
  );
  const industry = labels.rows.find(row => row.id === job.input.industryId)?.label;
  const style = labels.rows.find(row => row.id === job.input.styleId)?.label;
  if (!industry || !style) throw new ImageGenerationError('THEME_DICTIONARY_UNAVAILABLE');
  const template = await getActivePromptTemplate(database, 'theme', job.input.industryId, job.input.styleId);
  return buildThemePrompt(normalizeThemeInput(job.input), industry, style, template?.body);
}

async function sourceObjectKey(database: pg.Pool, job: ThemeJob): Promise<string> {
  const key =
    job.snapshot?.source.objectKey ??
    (
      await database.query<{ objectKey: string }>(
        `SELECT v.object_key AS "objectKey" FROM scheme_baseline_assets a
     JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.id = $1 AND a.is_active = true`,
        [job.sourceAssetId],
      )
    ).rows[0]?.objectKey;
  if (!key) throw new ImageGenerationError('THEME_SOURCE_UNAVAILABLE');
  return key;
}

async function maskObjectKey(database: pg.Pool, job: ThemeJob): Promise<string | undefined> {
  if (job.snapshot) return job.snapshot.mask?.objectKey;
  return (
    await database.query<{ objectKey: string }>(
      `SELECT v.object_key AS "objectKey" FROM scheme_baseline_assets a
     JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.related_asset_id = $1 AND a.type = 'mask' AND a.is_active = true LIMIT 1`,
      [job.sourceAssetId],
    )
  ).rows[0]?.objectKey;
}

async function loadMask(database: pg.Pool, job: ThemeJob, storage: ThemeStorage): Promise<Buffer | undefined> {
  const key = await maskObjectKey(database, job);
  if (!key) return undefined;
  const bytes = await storage.getBuffer(key, IMAGE_LIMITS.maxBytes);
  if (job.snapshot?.mask?.checksum && sha256(bytes) !== job.snapshot.mask.checksum) {
    throw new ImageGenerationError('THEME_MASK_INTEGRITY_INVALID');
  }
  return (await normalizeGeneratedImage(bytes)).bytes;
}

export const themeOptions = (job: ThemeJob): ThemePipelineOptions => job.snapshot?.options ?? LEGACY_THEME_OPTIONS;

/** 读取并校验来源图与蒙版原图（快照任务需校验 checksum），供生图输入与出图合成共用。 */
export async function loadThemeImages(database: pg.Pool, job: ThemeJob, storage: ThemeStorage): Promise<ThemeImages> {
  const key = await sourceObjectKey(database, job);
  const original = await storage.getBuffer(key, IMAGE_LIMITS.maxBytes);
  await normalizeGeneratedImage(original);
  if (job.snapshot?.source.checksum && sha256(original) !== job.snapshot.source.checksum) {
    throw new ImageGenerationError('THEME_SOURCE_INTEGRITY_INVALID');
  }
  return { original, mask: await loadMask(database, job, storage) };
}

/** 按任务冻结的选项生成供应商输入：透明背景可铺纯色；蒙版可不发送。 */
export async function themeEditInput(images: ThemeImages, options: ThemePipelineOptions): Promise<ThemeSource> {
  const reference =
    options.backgroundMode === 'fill'
      ? await sharp(images.original).flatten({ background: options.backgroundColor }).png().toBuffer()
      : images.original;
  const mask = options.sendMask && images.mask ? await toEditMask(images.mask) : undefined;
  return { reference, mask };
}
