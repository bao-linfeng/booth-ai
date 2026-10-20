import type pg from 'pg';
import type { createStorage } from '../../infra/storage.js';
import type { RenditionVariant, Renditions } from './renditions.js';

type Signer = Pick<ReturnType<typeof createStorage>, 'signDownload'>;

export interface StoredImage {
  objectKey: string;
  renditions?: Renditions | null;
}

/** 签发指定规格的展示地址；衍生图尚未生成时回退为原图，保证页面可显示。 */
export function signImage(storage: Signer, image: StoredImage, variant: RenditionVariant, expiresIn: number): Promise<string> {
  return storage.signDownload(image.renditions?.[variant]?.key ?? image.objectKey, expiresIn);
}

/** 只持有对象 key 的场景（项目快照、客服上下文）：先查该版本的衍生图再签发。 */
export async function signImageByKey(
  pool: Pick<pg.Pool, 'query'>,
  storage: Signer,
  objectKey: string,
  variant: RenditionVariant,
  expiresIn: number,
): Promise<string> {
  const row = (
    await pool.query<{ renditions: Renditions | null }>('SELECT renditions FROM asset_versions WHERE object_key = $1', [objectKey])
  ).rows[0];
  return signImage(storage, { objectKey, renditions: row?.renditions }, variant, expiresIn);
}

export async function signImageLinks(
  storage: Signer,
  image: StoredImage,
  expiresIn: number,
): Promise<{ thumbnailUrl: string; previewUrl: string }> {
  const [thumbnailUrl, previewUrl] = await Promise.all([
    signImage(storage, image, 'thumb', expiresIn),
    signImage(storage, image, 'preview', expiresIn),
  ]);
  return { thumbnailUrl, previewUrl };
}
