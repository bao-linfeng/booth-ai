import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { IMAGE_LIMITS, normalizeGeneratedImage } from '../../../infra/ai/image.js';
import type { ArtworkStorage, Database, Direction } from './types.js';

/** 报馆图视向，与资产元数据 `viewCodes` 的取值一致（见 assets/metadata.ts）。 */
type DrawingViewCode = 'front' | 'left' | 'top';

/**
 * 随方向请求附带的一张报馆图：俯视图提供平面布局，立面提供本方向的正交轮廓。
 * 报馆图只有正视图与左视图两个立面；背面、右侧用它们水平翻转——相反方向的正交轮廓互为镜像。
 */
export type ArtworkDrawing = {
  assetId: string;
  versionId: string;
  objectKey: string;
  checksum: string;
  role: 'top' | 'elevation';
  /** 源文件的视向。 */
  view: DrawingViewCode;
  mirrored: boolean;
};
/** 各方向附带的报馆图，按发送顺序排列（俯视图在前）；没有可用报馆图的方向不出现。 */
export type DirectionDrawings = Partial<Record<Direction, ArtworkDrawing[]>>;

export type DrawingCandidate = Omit<ArtworkDrawing, 'role' | 'view' | 'mirrored'> & { viewCodes: string[] };

/** 各方向的立面来源。 */
const ELEVATION_SOURCE: Record<Direction, { view: DrawingViewCode; mirrored: boolean }> = {
  front: { view: 'front', mirrored: false },
  back: { view: 'front', mirrored: true },
  left: { view: 'left', mirrored: false },
  right: { view: 'left', mirrored: true },
};
/** 发送前长边上限：结构参考不需要原图分辨率，压小后也不挤占供应商的单次请求体积。 */
const MAX_DRAWING_EDGE = 2048;
/** 视为纯色边条的行/列：各通道极差不超过该值。 */
const UNIFORM_LINE_RANGE = 12;

/** 方案当前生效、可作为图片发送的报馆图，按排序先后；同一视向有多张时取第一张。 */
export async function loadDrawingCandidates(database: Database, schemeCode: string): Promise<DrawingCandidate[]> {
  return (
    await database.query<DrawingCandidate>(
      `SELECT a.id AS "assetId", v.id AS "versionId", v.object_key AS "objectKey", v.checksum,
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.metadata->'viewCodes') = 'array'
          THEN a.metadata->'viewCodes' ELSE '[]'::jsonb END)), '{}') AS "viewCodes"
      FROM schemes s
      JOIN scheme_baseline_assets a ON a.scheme_id = s.id AND a.type = 'drawing' AND a.is_active
      JOIN LATERAL (SELECT id, object_key, checksum, mime_type, byte_size FROM asset_versions
        WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
      WHERE s.code = $1 AND v.byte_size > 0 AND v.mime_type IN ('image/png', 'image/jpeg', 'image/webp')
      ORDER BY a.sort_order, a.created_at, a.id`,
      [schemeCode],
    )
  ).rows;
}

/**
 * 为启用的方向挑选报馆图：俯视图 + 本方向立面（背面、右侧为正视图、左视图翻转）。
 * `maxDrawings` 是模型单次还能接收的附加图片数，不足两张时优先保留立面。
 */
export function planDirectionDrawings(candidates: DrawingCandidate[], directions: Direction[], maxDrawings: number): DirectionDrawings {
  const find = (view: DrawingViewCode) => candidates.find(candidate => candidate.viewCodes.includes(view));
  const pick = (candidate: DrawingCandidate, role: ArtworkDrawing['role'], view: DrawingViewCode, mirrored: boolean): ArtworkDrawing => {
    const { viewCodes: _viewCodes, ...file } = candidate;
    return { ...file, role, view, mirrored };
  };
  const top = find('top');
  const plan: DirectionDrawings = {};
  for (const direction of directions) {
    const { view, mirrored } = ELEVATION_SOURCE[direction];
    const source = find(view);
    const elevation = source && pick(source, 'elevation', view, mirrored);
    const drawings = [top && pick(top, 'top', 'top', false), elevation].filter((drawing): drawing is ArtworkDrawing => !!drawing);
    const kept = drawings.length <= maxDrawings ? drawings : (elevation ? [elevation] : drawings).slice(0, maxDrawings);
    if (kept.length) plan[direction] = kept;
  }
  return plan;
}

/** 去掉四周纯色的行与列（如 SketchUp 导出图上下的深色边条与留白），避免被当作结构。 */
async function trimUniformBorders(image: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(image, { limitInputPixels: IMAGE_LIMITS.maxPixels }).metadata();
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const { data, info } = await sharp(image, { limitInputPixels: IMAGE_LIMITS.maxPixels })
    .flatten({ background: '#FFFFFF' })
    .resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const uniform = (pixels: number[]) => {
    for (let channel = 0; channel < 3; channel++) {
      let min = 255;
      let max = 0;
      for (const pixel of pixels) {
        const value = data[pixel * 3 + channel]!;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      if (max - min > UNIFORM_LINE_RANGE) return false;
    }
    return true;
  };
  let top = 0;
  let bottom = info.height - 1;
  let left = 0;
  let right = info.width - 1;
  const row = (y: number) => Array.from({ length: info.width }, (_, x) => y * info.width + x);
  // 列只在保留下来的行范围内判断，上下边条不影响左右留白的识别
  const column = (x: number) => Array.from({ length: bottom - top + 1 }, (_, y) => (top + y) * info.width + x);
  while (top < bottom && uniform(row(top))) top++;
  while (bottom > top && uniform(row(bottom))) bottom--;
  while (left < right && uniform(column(left))) left++;
  while (right > left && uniform(column(right))) right--;
  if (bottom - top < info.height / 10 || right - left < info.width / 10) return image;
  const x = Math.floor(left / scale);
  const y = Math.floor(top / scale);
  return sharp(image, { limitInputPixels: IMAGE_LIMITS.maxPixels })
    .extract({
      left: x,
      top: y,
      width: Math.min(width - x, Math.ceil((right + 1) / scale) - x),
      height: Math.min(height - y, Math.ceil((bottom + 1) / scale) - y),
    })
    .png()
    .toBuffer();
}

/** 读取并校验报馆图，裁掉纯色边条、按需去色与水平翻转，输出发送用 PNG。 */
export async function prepareDrawing(storage: Pick<ArtworkStorage, 'getBuffer'>, drawing: ArtworkDrawing, grayscale: boolean) {
  const bytes = await storage.getBuffer(drawing.objectKey, IMAGE_LIMITS.maxBytes);
  if (createHash('sha256').update(bytes).digest('hex') !== drawing.checksum.toLowerCase())
    throw new Error('Artwork drawing integrity mismatch');
  await normalizeGeneratedImage(bytes);
  let image = sharp(await trimUniformBorders(bytes), { limitInputPixels: IMAGE_LIMITS.maxPixels })
    .flatten({ background: '#FFFFFF' })
    .resize({ width: MAX_DRAWING_EDGE, height: MAX_DRAWING_EDGE, fit: 'inside', withoutEnlargement: true });
  if (grayscale) image = image.grayscale().toColourspace('srgb');
  if (drawing.mirrored) image = image.flop();
  return image.png().toBuffer();
}
