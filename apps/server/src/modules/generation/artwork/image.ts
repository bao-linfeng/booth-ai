import { ImageGenerationError, isOutputAspect, normalizeGeneratedImage } from '../../../infra/ai/image.js';
import { ARTWORK_QUALITY } from './types.js';

/** 按画稿质量门槛校验图片；通用的 `IMAGE_*` 错误码改写为 `ARTWORK_*`，写入方向失败原因。 */
export async function normalizeArtworkImage(bytes: Buffer) {
  try {
    const image = await normalizeGeneratedImage(bytes, ARTWORK_QUALITY.minLongEdge, ARTWORK_QUALITY.minShortEdge);
    if (!isOutputAspect(image.width, image.height)) throw new ImageGenerationError('IMAGE_ASPECT_INVALID');
    return image;
  } catch (error) {
    if (error instanceof ImageGenerationError) throw new Error(error.code.replace(/^IMAGE_/, 'ARTWORK_'));
    throw error;
  }
}
