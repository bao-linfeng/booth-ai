import { ImageGenerationError, isOutputAspect, normalizeGeneratedImage } from '../../../infra/ai/image.js';

/**
 * 校验并转为 PNG；通用的 `IMAGE_*` 错误码改写为 `ARTWORK_*`，写入方向失败原因。
 * 低于高清门槛的图片照常入库并结算，只是交付不完整（见 `completeArtworkFiles`），由用户决定是否重新生成。
 */
export async function normalizeArtworkImage(bytes: Buffer) {
  try {
    const image = await normalizeGeneratedImage(bytes);
    if (!isOutputAspect(image.width, image.height)) throw new ImageGenerationError('IMAGE_ASPECT_INVALID');
    return image;
  } catch (error) {
    if (error instanceof ImageGenerationError) throw new Error(error.code.replace(/^IMAGE_/, 'ARTWORK_'));
    throw error;
  }
}
