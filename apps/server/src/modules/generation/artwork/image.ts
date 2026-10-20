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
 * 四面素材按 JPEG 入库与交付：供应商本就返回 JPEG 95，再转 PNG 只会让文件大几倍、没有画质收益，
 * 而预览与下载都经服务器有限的上行带宽发出。历史任务的结果仍为 PNG，按 `artworkFileExtension` 识别。
 */
export const ARTWORK_FILE = { mimeType: 'image/jpeg', extension: 'jpg' } as const;
export const ARTWORK_MIME_TYPES = ['image/jpeg', 'image/png'];
export const artworkFileExtension = (mimeType: string) => (mimeType === 'image/png' ? 'png' : 'jpg');

/**
 * 校验并编码为 JPEG（已是 JPEG 的原样保留）；通用的 `IMAGE_*` 错误码改写为 `ARTWORK_*`，写入方向失败原因。
 * 低于高清门槛的图片照常入库并结算，只是交付不完整（见 `completeArtworkFiles`），由用户决定是否重新生成。
 */
export async function normalizeArtworkImage(bytes: Buffer) {
  try {
    const image = await normalizeGeneratedImage(bytes, 1, 1, 'jpeg');
    if (!isOutputAspect(image.width, image.height)) throw new ImageGenerationError('IMAGE_ASPECT_INVALID');
    return image;
  } catch (error) {
    if (error instanceof ImageGenerationError) throw new Error(error.code.replace(/^IMAGE_/, 'ARTWORK_'));
    throw error;
  }
}
