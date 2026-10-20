import type { Sharp } from 'sharp';
import { ImageGenerationError, isOutputAspect, normalizeGeneratedImage } from '../../../infra/ai/image.js';

/**
 * 参考图与报馆图编码为 JPEG 再发给供应商。服务器上行带宽有限（生产仅 3 Mbps），PNG 参考图约 2 MB，
 * 四个方向并发上传会把单次请求拖过提交超时：供应商照常出图计费，结果却收不到。JPEG 90 约为 PNG 的十分之一。
 */
export function encodeUploadImage(image: Sharp): Promise<Buffer> {
  return image.flatten({ background: '#FFFFFF' }).jpeg({ quality: 90 }).toBuffer();
}

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
