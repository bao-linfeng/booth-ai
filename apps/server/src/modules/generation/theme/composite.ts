import sharp from 'sharp';
import { editableMap } from './mask.js';

/** 生成图相对原图的缩放（以画面中心为基准）与平移，单位为原图像素：原图 (x,y) 对应生成图 (cx+(x-cx)·scale+dx, cy+(y-cy)·scale+dy)。 */
export type Alignment = { scale: number; dx: number; dy: number };
export type AlignmentEstimate = {
  alignment: Alignment;
  /** 最优解贴着搜索范围边界，说明生成图变形超出可对齐范围，合成会错位。 */
  reliable: boolean;
  /** 对齐前后采样区边缘的归一化互相关（越接近 1 越吻合）与分块偏移，用于日志诊断。 */
  structureScore: { before: number; after: number; drift: number } | null;
};
export type CompositeResult = {
  bytes: Buffer<ArrayBuffer>;
  width: number;
  height: number;
  alignment: Alignment;
  structureScore: AlignmentEstimate['structureScore'];
};

const COARSE_WIDTH = 192;
const FINE_WIDTH = 768;
const MAX_COARSE_SAMPLES = 3_000;
const MAX_FINE_SAMPLES = 20_000;
const MIN_SAMPLES = 200;
// 模型常把展台整体放大并平移（实测缩放 1.0–1.2、平移数十像素），几乎不缩小。
const SCALE_RANGE = [0.95, 1.25] as const;
const COARSE_SHIFT = 16;
// 归一化互相关至少提升这么多才采用对齐结果，否则视为无可靠对齐、保持原位。
const MIN_GAIN = 0.02;
// 分块校验：各块最优平移与全局解相差超过 MAX_LOCAL_DRIFT（细层像素，约为原图宽的 1%）即判为无法对齐。
const LOCAL_SHIFT = 12;
const MAX_LOCAL_DRIFT = 8;
const EDGE_DILATE = 3;
const EDGE_BLUR_SIGMA = 1.2;

/** 可分离的方形 max/min 滤波（半径 r），用于蒙版外扩与采样区收缩。越界按 0 处理。 */
function rankFilter(map: Uint8Array, width: number, height: number, radius: number, pick: 'max' | 'min'): Uint8Array {
  const better = pick === 'max' ? (a: number, b: number) => a > b : (a: number, b: number) => a < b;
  const pass = (input: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(input.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let value = input[y * width + x]!;
        for (let d = -radius; d <= radius; d++) {
          const xx = horizontal ? x + d : x;
          const yy = horizontal ? y : y + d;
          const sample = xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : input[yy * width + xx]!;
          if (better(sample, value)) value = sample;
        }
        out[y * width + x] = value;
      }
    return out;
  };
  return pass(pass(map, true), false);
}

/** 梯度幅值再做 3×3 均值，放宽对齐代价的收敛范围。 */
function edgeMap(gray: Uint8Array, width: number, height: number): Float32Array {
  const grad = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      grad[i] = Math.abs(gray[i + 1]! - gray[i - 1]!) + Math.abs(gray[i + width]! - gray[i - width]!);
    }
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += grad[(y + dy) * width + x + dx]!;
      out[y * width + x] = sum / 9;
    }
  return out;
}

type Level = {
  width: number;
  height: number;
  original: Float32Array;
  generated: Float32Array;
  samples: Int32Array;
  /** 只含不透明、且离可编辑区 ≥3px 的结构像素（不含新画面纹理），用于分块校验。 */
  structure: Int32Array;
};

async function grayAt(image: Buffer, width: number, height: number): Promise<Uint8Array> {
  return sharp(image)
    .resize(width, height, { fit: 'fill' })
    .flatten({ background: '#000000' })
    .toColourspace('b-w')
    .extractChannel(0)
    .raw()
    .toBuffer();
}

/**
 * 采样区：展台轮廓（含外沿 2px）内的不可编辑像素，即结构、家具展品、展台外轮廓与面板外沿——
 * 这些在原图和生成图中位置应一致；面板内的新画面纹理不参与，避免周期图案把对齐带偏。
 */
async function level(original: Buffer, generated: Buffer, maskImage: Buffer, width: number, height: number, maxSamples: number) {
  const [gray, genGray, alpha, editable] = await Promise.all([
    grayAt(original, width, height),
    grayAt(generated, width, height),
    sharp(original).resize(width, height, { fit: 'fill' }).ensureAlpha().extractChannel(3).raw().toBuffer(),
    editableMap(maskImage, width, height),
  ]);
  const opaque = new Uint8Array(width * height);
  for (let p = 0; p < opaque.length; p++) opaque[p] = alpha[p]! > 128 ? 255 : 0;
  const booth = rankFilter(opaque, width, height, 2, 'max');
  const solid = rankFilter(opaque, width, height, 1, 'min');
  const nearEdit = rankFilter(editable, width, height, 3, 'max');
  const all: number[] = [];
  const structure: number[] = [];
  for (let y = 2; y < height - 2; y++)
    for (let x = 2; x < width - 2; x++) {
      const p = y * width + x;
      if (booth[p] && !editable[p]) all.push(p);
      if (solid[p] && !nearEdit[p]) structure.push(p);
    }
  const thin = (points: number[]) => {
    const stride = Math.max(1, Math.ceil(points.length / maxSamples));
    return Int32Array.from(points.filter((_, index) => index % stride === 0));
  };
  return {
    width,
    height,
    original: edgeMap(gray, width, height),
    generated: edgeMap(genGray, width, height),
    samples: thin(all),
    structure: thin(structure),
  } satisfies Level;
}

/** 采样点上原图与变换后生成图边缘图的归一化互相关（-1..1），对亮度与对比度变化不敏感。 */
function correlation(level: Level, scale: number, dx: number, dy: number): number {
  const { width, height, original, generated, samples } = level;
  const cx = width / 2;
  const cy = height / 2;
  let so = 0;
  let sg = 0;
  let soo = 0;
  let sgg = 0;
  let sog = 0;
  for (let n = 0; n < samples.length; n++) {
    const i = samples[n]!;
    const x = i % width;
    const y = (i - x) / width;
    const u = Math.round(cx + (x - cx) * scale + dx);
    const v = Math.round(cy + (y - cy) * scale + dy);
    const o = original[i]!;
    const g = u < 0 || v < 0 || u >= width || v >= height ? 0 : generated[v * width + u]!;
    so += o;
    sg += g;
    soo += o * o;
    sgg += g * g;
    sog += o * g;
  }
  const n = samples.length;
  const denominator = Math.sqrt((soo - (so * so) / n) * (sgg - (sg * sg) / n));
  return denominator ? (sog - (so * sg) / n) / denominator : 0;
}

/**
 * 全局对齐后把结构像素按 2×2 分块，各块在 ±LOCAL_SHIFT 内单独找最优平移；返回各块相对全局解的最大偏移（细层像素）。
 * 模型改了视角或拉伸画面时各块要求的平移不一致，单一缩放+平移无法对齐。
 */
function localDisagreement(level: Level, scale: number, dx: number, dy: number): number {
  const { width, height, structure } = level;
  const blocks: number[][] = [[], [], [], []];
  for (const i of structure) {
    const x = i % width;
    const y = (i - x) / width;
    blocks[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)]!.push(i);
  }
  let worst = 0;
  for (const block of blocks) {
    if (block.length < MIN_SAMPLES) continue;
    const sub = { ...level, samples: Int32Array.from(block) };
    const best = search(
      sub,
      { scale, dx, dy },
      [scale],
      steps(dx - LOCAL_SHIFT, dx + LOCAL_SHIFT, 1),
      steps(dy - LOCAL_SHIFT, dy + LOCAL_SHIFT, 1),
    );
    worst = Math.max(worst, Math.hypot(best.dx - dx, best.dy - dy));
  }
  return worst;
}

/** 从 start 出发穷举；只有严格更优才替换，平局（如无纹理画面）保持 start。 */
function search(level: Level, start: Alignment, scales: number[], dxs: number[], dys: number[]) {
  let best = { ...start, score: correlation(level, start.scale, start.dx, start.dy) };
  for (const scale of scales)
    for (const dy of dys)
      for (const dx of dxs) {
        const score = correlation(level, scale, dx, dy);
        if (score > best.score + 1e-9) best = { scale, dx, dy, score };
      }
  return best;
}

const steps = (from: number, to: number, step: number) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, index) => Math.round((from + index * step) * 1e4) / 1e4);
const round2 = (value: number) => Math.round(value * 100) / 100;

/** 粗到细穷举缩放与平移，使生成图在采样区的边缘结构与原图最吻合；提升不足时保持原位。 */
export async function estimateAlignment(
  original: Buffer,
  generated: Buffer,
  maskImage: Buffer,
  width: number,
  height: number,
): Promise<AlignmentEstimate> {
  const identity = { scale: 1, dx: 0, dy: 0 };
  const coarse = await level(original, generated, maskImage, COARSE_WIDTH, Math.round((COARSE_WIDTH * height) / width), MAX_COARSE_SAMPLES);
  // 蒙版几乎盖满展台、没有可比对的结构时无法验证对齐，按不可靠处理（保留模型原图）。
  if (coarse.samples.length < MIN_SAMPLES) return { alignment: identity, reliable: false, structureScore: null };
  const c = search(
    coarse,
    identity,
    steps(SCALE_RANGE[0], SCALE_RANGE[1], 0.02),
    steps(-COARSE_SHIFT, COARSE_SHIFT, 1),
    steps(-COARSE_SHIFT, COARSE_SHIFT, 1),
  );
  const onBoundary =
    c.scale <= SCALE_RANGE[0] || c.scale >= SCALE_RANGE[1] || Math.abs(c.dx) >= COARSE_SHIFT || Math.abs(c.dy) >= COARSE_SHIFT;
  const fine = await level(original, generated, maskImage, FINE_WIDTH, Math.round((FINE_WIDTH * height) / width), MAX_FINE_SAMPLES);
  const ratio = fine.width / coarse.width;
  const fineStart = { scale: c.scale, dx: Math.round(c.dx * ratio), dy: Math.round(c.dy * ratio) };
  const f = search(
    fine,
    fineStart,
    steps(c.scale - 0.02, c.scale + 0.02, 0.002),
    steps(Math.round(c.dx * ratio) - 4, Math.round(c.dx * ratio) + 4, 1),
    steps(Math.round(c.dy * ratio) - 4, Math.round(c.dy * ratio) + 4, 1),
  );
  const before = correlation(fine, 1, 0, 0);
  const keepIdentity = f.score - before < MIN_GAIN;
  const chosen = keepIdentity ? { ...identity, score: before } : f;
  const drift = localDisagreement(fine, chosen.scale, chosen.dx, chosen.dy);
  const structureScore = { before: round2(before), after: round2(chosen.score), drift: round2(drift) };
  const alignment = { scale: chosen.scale, dx: (chosen.dx * width) / fine.width, dy: (chosen.dy * height) / fine.height };
  return { alignment, reliable: (keepIdentity || !onBoundary) && drift <= MAX_LOCAL_DRIFT, structureScore };
}

/** 双线性采样，把生成图（已缩放到原图尺寸的 RGB）变换到原图坐标。 */
function warp(rgb: Buffer, width: number, height: number, { scale, dx, dy }: Alignment): Buffer {
  const out = Buffer.alloc(width * height * 3);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = Math.min(Math.max(cx + (x - cx) * scale + dx, 0), width - 1.001);
      const v = Math.min(Math.max(cy + (y - cy) * scale + dy, 0), height - 1.001);
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      const a = (y0 * width + x0) * 3;
      const b = a + 3;
      const c = a + width * 3;
      const d = c + 3;
      for (let ch = 0; ch < 3; ch++)
        out[(y * width + x) * 3 + ch] = Math.round(
          rgb[a + ch]! * (1 - fx) * (1 - fy) + rgb[b + ch]! * fx * (1 - fy) + rgb[c + ch]! * (1 - fx) * fy + rgb[d + ch]! * fx * fy,
        );
    }
  return out;
}

/**
 * 把生成图对齐到原图后，只取蒙版可编辑区域（外扩并羽化以盖住旧画面描边），其余像素（含透明背景）保持原图。
 * 输出尺寸与原图一致的 RGBA PNG；生成图变形超出可对齐范围时返回 skipped，由调用方保留模型原图。
 */
export async function compositeThemeResult(
  original: Buffer,
  maskImage: Buffer,
  generated: Buffer,
): Promise<CompositeResult | { skipped: AlignmentEstimate }> {
  const { data: base, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const { data: rgb, info: genInfo } = await sharp(generated)
    .resize(width, height, { fit: 'fill' })
    .flatten({ background: '#000000' })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (genInfo.channels !== 3) throw new Error('Unexpected generated image channels');
  const estimate = await estimateAlignment(original, generated, maskImage, width, height);
  if (!estimate.reliable) return { skipped: estimate };
  const { alignment, structureScore } = estimate;
  const aligned = warp(rgb, width, height, alignment);
  const dilated = rankFilter(await editableMap(maskImage, width, height), width, height, EDGE_DILATE, 'max');
  const soft = await sharp(Buffer.from(dilated), { raw: { width, height, channels: 1 } })
    .blur(EDGE_BLUR_SIGMA)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const a = soft[p]! / 255;
    const baseAlpha = base[p * 4 + 3]! / 255;
    const alpha = a + baseAlpha * (1 - a);
    for (let ch = 0; ch < 3; ch++)
      out[p * 4 + ch] = alpha ? Math.round((aligned[p * 3 + ch]! * a + base[p * 4 + ch]! * baseAlpha * (1 - a)) / alpha) : 0;
    out[p * 4 + 3] = Math.round(alpha * 255);
  }
  const bytes = await sharp(out, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return { bytes, width, height, alignment, structureScore };
}
