import type { AssetVersion } from '#/api/core/assets';

/** 效果图/蒙版规格校验，与服务端上传及发布就绪检查保持同一规则。 */
export interface ImageSize {
  width: number;
  height: number;
}

type VersionSize = null | Pick<AssetVersion, 'heightPx' | 'widthPx'>;

export function formatImageSize(size: ImageSize): string {
  return `${size.width}×${size.height}`;
}

export function versionImageSize(
  version: undefined | VersionSize,
): ImageSize | null {
  return version?.widthPx && version.heightPx
    ? { width: version.widthPx, height: version.heightPx }
    : null;
}

function sameSize(a: ImageSize, b: ImageSize): boolean {
  return a.width === b.width && a.height === b.height;
}

/** 效果图必须严格 16:9，不允许容差。 */
export function renderingSizeError(size: ImageSize): string | undefined {
  if (size.width > 0 && size.width * 9 === size.height * 16) return undefined;
  return `效果图需为严格 16:9（如 1600×900、1920×1080），当前 ${formatImageSize(size)}`;
}

/** 蒙版像素尺寸必须与配对效果图完全一致。 */
export function maskSizeError(
  size: ImageSize,
  rendering: ImageSize | null,
): string | undefined {
  if (!rendering) return '配对效果图尚未上传文件，无法上传蒙版';
  if (sameSize(size, rendering)) return undefined;
  return `蒙版尺寸需与配对效果图一致（${formatImageSize(rendering)}），当前 ${formatImageSize(size)}`;
}

/** 替换效果图后，已配对蒙版尺寸不再一致时的提示；一致或无蒙版时返回 undefined。 */
export function pairedMaskWarning(
  next: ImageSize,
  mask: undefined | { currentVersion: VersionSize; name: string },
): string | undefined {
  const maskSize = versionImageSize(mask?.currentVersion);
  if (!mask || !maskSize || sameSize(next, maskSize)) return undefined;
  return `已配对蒙版「${mask.name}」为 ${formatImageSize(maskSize)}，与新效果图 ${formatImageSize(next)} 不一致。替换后方案将无法发布，需随后替换该蒙版。是否继续？`;
}

export function readImageSize(file: Blob): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    });
    img.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败，请重新选择'));
    });
    img.src = url;
  });
}
