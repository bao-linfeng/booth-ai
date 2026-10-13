import sharp from 'sharp';

/**
 * 蒙版约定：不透明的品红像素为可编辑区域。蒙版通常是透明背景 PNG，透明像素的 RGB 可能恰为品红，
 * 必须同时看 alpha，否则透明背景会被误判为可编辑。
 */
export const isEditablePixel = (rgba: Uint8Array, offset: number) =>
  rgba[offset + 3]! > 128 && rgba[offset]! > 200 && rgba[offset + 1]! < 60 && rgba[offset + 2]! > 200;

/** 转为供应商编辑蒙版（OpenAI 约定）：可编辑区域透明，其余不透明。尺寸保持与蒙版原图一致。 */
export async function toEditMask(maskImage: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(maskImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);
  for (let p = 0; p < info.width * info.height; p++) {
    out[p * 4] = data[p * 4]!;
    out[p * 4 + 1] = data[p * 4 + 1]!;
    out[p * 4 + 2] = data[p * 4 + 2]!;
    out[p * 4 + 3] = isEditablePixel(data, p * 4) ? 0 : 255;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

/** 缩放到目标尺寸（最近邻，避免插值出非品红的过渡色）后的单通道可编辑图：255 可编辑，0 保留。 */
export async function editableMap(maskImage: Buffer, width: number, height: number): Promise<Uint8Array> {
  const data = await sharp(maskImage).resize(width, height, { fit: 'fill', kernel: 'nearest' }).ensureAlpha().raw().toBuffer();
  const map = new Uint8Array(width * height);
  for (let p = 0; p < map.length; p++) map[p] = isEditablePixel(data, p * 4) ? 255 : 0;
  return map;
}
