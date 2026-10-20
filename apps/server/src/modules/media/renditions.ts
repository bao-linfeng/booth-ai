import sharp from 'sharp';
import { errorCode, type Logger } from '../../infra/logger.js';
import type { createStorage } from '../../infra/storage.js';

export type RenditionVariant = 'thumb' | 'preview';

export interface Rendition {
  key: string;
  width: number;
  height: number;
  bytes: number;
}

export type Renditions = Record<RenditionVariant, Rendition>;

// 长边上限与 WebP 质量，按真实方案图、主题结果与四向画稿对比确定（见 docs/客户端图片加载优化方案.md）。
// 调整参数时升级 RENDITION_VERSION，并追加迁移清空 asset_versions.renditions，由 Worker 重新生成。
const RENDITION_VERSION = 'v1';
const SPECS: Record<RenditionVariant, { size: number; quality: number }> = {
  thumb: { size: 480, quality: 80 },
  preview: { size: 1600, quality: 82 },
};

export function renditionKey(objectKey: string, variant: RenditionVariant): string {
  return `renditions/${RENDITION_VERSION}/${objectKey}/${variant}.webp`;
}

/** 按固定规格生成缩略图与预览图并上传；key 由原对象推导，重复生成只会覆盖为相同内容。 */
export async function createRenditions(
  storage: Pick<ReturnType<typeof createStorage>, 'putBuffer'>,
  objectKey: string,
  source: Buffer,
): Promise<Renditions> {
  const oriented = sharp(source).rotate();
  const renditions: Partial<Renditions> = {};
  for (const variant of ['thumb', 'preview'] as const) {
    const { size, quality } = SPECS[variant];
    const { data, info } = await oriented
      .clone()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, alphaQuality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const key = renditionKey(objectKey, variant);
    await storage.putBuffer(key, data, 'image/webp');
    renditions[variant] = { key, width: info.width, height: info.height, bytes: data.byteLength };
  }
  return renditions as Renditions;
}

/** 入库时用内存中的图片就地生成；失败只记日志并返回 null，由 Worker 补齐任务重试，不影响调用方。 */
export async function createRenditionsOrDefer(
  storage: Pick<ReturnType<typeof createStorage>, 'putBuffer'>,
  objectKey: string,
  source: Buffer,
  log: Pick<Logger, 'warn'>,
): Promise<Renditions | null> {
  try {
    return await createRenditions(storage, objectKey, source);
  } catch (error) {
    log.warn({ objectKey, code: errorCode(error) }, 'Image rendition deferred');
    return null;
  }
}
