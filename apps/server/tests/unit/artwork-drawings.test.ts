import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import sharp from 'sharp';
import {
  planDirectionDrawings,
  prepareDrawing,
  type ArtworkDrawing,
  type DrawingCandidate,
} from '../../src/modules/generation/artwork/drawings.js';
import { buildArtworkPrompts } from '../../src/modules/generation/artwork/prompt.js';
import { loadArtworkSnapshot } from '../../src/modules/generation/artwork/service.js';
import { DIRECTIONS } from '../../src/modules/generation/artwork/types.js';
import { artworkSettingsRow, assignedRow } from '../helpers/ai-fixtures.js';

const candidate = (id: string, viewCodes: string[]): DrawingCandidate => ({
  assetId: `asset-${id}`,
  versionId: `version-${id}`,
  objectKey: `drawings/${id}.png`,
  checksum: `checksum-${id}`,
  viewCodes,
});
const summary = (drawings: ArtworkDrawing[] | undefined) =>
  drawings?.map(d => `${d.role}:${d.versionId}:${d.view}${d.mirrored ? ':mirrored' : ''}`);
const input = { industryId: 'industry', styleId: 'style', brandColors: [], brandKeywords: '' };

test('each direction gets the top view plus its elevation, with back and right mirrored from front and left', () => {
  const candidates = [candidate('top', ['top']), candidate('front', ['front']), candidate('left', ['left']), candidate('left-2', ['left'])];
  const plan = planDirectionDrawings(candidates, [...DIRECTIONS], 2);
  assert.deepEqual(summary(plan.front), ['top:version-top:top', 'elevation:version-front:front']);
  assert.deepEqual(summary(plan.back), ['top:version-top:top', 'elevation:version-front:front:mirrored']);
  // 同一视向有多张时取排序靠前的一张
  assert.deepEqual(summary(plan.left), ['top:version-top:top', 'elevation:version-left:left']);
  assert.deepEqual(summary(plan.right), ['top:version-top:top', 'elevation:version-left:left:mirrored']);
  assert.deepEqual(plan.front?.[0], {
    assetId: 'asset-top',
    versionId: 'version-top',
    objectKey: 'drawings/top.png',
    checksum: 'checksum-top',
    role: 'top',
    view: 'top',
    mirrored: false,
  });
});

test('drawing plan honours enabled directions, missing views and the model input limit', () => {
  const candidates = [candidate('top', ['top']), candidate('front', ['front'])];
  assert.deepEqual(Object.keys(planDirectionDrawings(candidates, ['back'], 2)), ['back']);
  // 没有左视图时左右只带俯视图
  assert.deepEqual(summary(planDirectionDrawings(candidates, ['left'], 2).left), ['top:version-top:top']);
  // 模型只能多接收一张时优先保留立面
  assert.deepEqual(summary(planDirectionDrawings(candidates, ['front'], 1).front), ['elevation:version-front:front']);
  assert.deepEqual(planDirectionDrawings(candidates, ['front'], 0), {});
  assert.deepEqual(planDirectionDrawings([candidate('untagged', [])], [...DIRECTIONS], 2), {});
  assert.deepEqual(planDirectionDrawings(candidates, [], 2), {});
});

test('direction prompts number the drawings after the theme image and describe each elevation', () => {
  const plan = planDirectionDrawings(
    [candidate('top', ['top']), candidate('front', ['front']), candidate('left', ['left'])],
    ['front', 'back', 'right'],
    2,
  );
  const { prompt, directionPrompts } = buildArtworkPrompts(input, '汽车', '科技', undefined, { plan, grayscale: true });
  assert.match(prompt, /根据提供的唯一一张主题效果参考图/);
  assert.doesNotMatch(prompt, /结构校正参考图/);
  for (const direction of ['front', 'back', 'right'] as const) {
    const text = directionPrompts[direction];
    assert.doesNotMatch(text, /唯一一张主题效果参考图/);
    assert.match(text, /根据提供的第1张主题效果参考图/);
    assert.match(text, /【结构校正参考图（第2–3张）】/);
    assert.match(text, /正交投影、几何准确、已去色/);
    assert.match(text, /- 第2张 俯视图：展台平面/);
    assert.match(text, /输出构图须与第3张的轮廓一致/);
    assert.match(text, /严禁出现在输出中/);
    assert.doesNotMatch(text, /undefined/);
  }
  assert.match(directionPrompts.front, /- 第3张 正面立面：/);
  assert.match(directionPrompts.back, /- 第3张 背面轮廓：由正视图水平翻转得到/);
  assert.match(directionPrompts.right, /- 第3张 右侧轮廓：由左视图水平翻转得到/);
  // 未启用报馆图的方向保持原提示词
  assert.match(directionPrompts.left, /根据提供的唯一一张主题效果参考图/);
  assert.doesNotMatch(directionPrompts.left, /结构校正参考图/);
  assert.equal(directionPrompts.left, buildArtworkPrompts(input, '汽车', '科技').directionPrompts.left);

  const colour = buildArtworkPrompts(input, '汽车', '科技', undefined, { plan, grayscale: false }).directionPrompts.front;
  assert.match(colour, /正交投影、几何准确）/);
  const topOnly = buildArtworkPrompts(input, '汽车', '科技', undefined, {
    plan: planDirectionDrawings([candidate('top', ['top'])], ['left'], 2),
    grayscale: true,
  }).directionPrompts.left;
  assert.match(topOnly, /【结构校正参考图（第2张）】/);
  assert.match(topOnly, /各结构的平面位置、前后左右关系与尺寸比例以第2张为准/);
});

test('every direction elevation has a description', () => {
  const plan = planDirectionDrawings([candidate('front', ['front']), candidate('left', ['left'])], [...DIRECTIONS], 2);
  for (const direction of DIRECTIONS) {
    const text = buildArtworkPrompts(input, '', '', undefined, { plan, grayscale: true }).directionPrompts[direction];
    assert.match(text, /- 第2张 \S+：/, direction);
    assert.doesNotMatch(text, /undefined/, direction);
  }
});

test('drawings are verified, trimmed of flat borders, desaturated and mirrored before sending', async () => {
  // 模拟 SketchUp 导出：上下深色边条、灰色留白，左侧有一块红色结构
  const width = 1200;
  const height = 700;
  const source = await sharp({ create: { width, height, channels: 3, background: '#C5CCCF' } })
    .composite([
      { input: { create: { width, height: 30, channels: 3, background: '#666A6B' } }, top: 0, left: 0 },
      { input: { create: { width, height: 30, channels: 3, background: '#666A6B' } }, top: height - 30, left: 0 },
      { input: { create: { width: 300, height: 400, channels: 3, background: '#D02020' } }, top: 150, left: 200 },
      { input: { create: { width: 500, height: 400, channels: 3, background: '#2050D0' } }, top: 150, left: 500 },
    ])
    .png()
    .toBuffer();
  const drawing: ArtworkDrawing = {
    assetId: 'asset',
    versionId: 'version',
    objectKey: 'drawing.png',
    checksum: createHash('sha256').update(source).digest('hex').toUpperCase(),
    role: 'elevation',
    view: 'front',
    mirrored: false,
  };
  const storage = { getBuffer: async () => source };
  const prepared = await prepareDrawing(storage, drawing, true);
  assert.equal((await sharp(prepared).metadata()).format, 'jpeg');
  const { data, info } = await sharp(prepared).raw().toBuffer({ resolveWithObject: true });
  // 边界在缩小后的图上识别，允许几个像素的误差
  assert.ok(Math.abs(info.width - 800) <= 4, `width ${info.width}`);
  assert.ok(Math.abs(info.height - 400) <= 4, `height ${info.height}`);
  assert.equal(info.channels, 3);
  const middle = Math.floor(info.height / 2) * info.width;
  const pixel = (x: number) => [...data.subarray((middle + x) * info.channels, (middle + x) * info.channels + 3)];
  // JPEG 有损，颜色比较留出编码误差
  const near = (actual: number[], expected: number[]) => actual.every((value, index) => Math.abs(value - expected[index]!) <= 6);
  for (const x of [10, info.width - 10]) assert.ok(near(pixel(x), [pixel(x)[0]!, pixel(x)[0]!, pixel(x)[0]!]), `gray at ${x}`);
  assert.ok(Math.abs(pixel(10)[0]! - pixel(info.width - 10)[0]!) > 5);

  const mirrored = await prepareDrawing(storage, { ...drawing, mirrored: true }, false);
  const flipped = await sharp(mirrored).raw().toBuffer({ resolveWithObject: true });
  const row = Math.floor(flipped.info.height / 2) * flipped.info.width;
  const at = (x: number) => [...flipped.data.subarray((row + x) * flipped.info.channels, (row + x) * flipped.info.channels + 3)];
  assert.ok(near(at(flipped.info.width - 10), [0xd0, 0x20, 0x20]), String(at(flipped.info.width - 10)));
  assert.ok(near(at(10), [0x20, 0x50, 0xd0]), String(at(10)));

  await assert.rejects(prepareDrawing(storage, { ...drawing, checksum: 'other' }, true), /integrity/);
});

test('artwork snapshot freezes the drawing plan and pipeline options for the enabled directions', async () => {
  const drawingRows = [candidate('top', ['top']), candidate('front', ['front'])];
  let settings: typeof artworkSettingsRow | { drawingDirections: string[]; drawingGrayscale: boolean } = {
    ...artworkSettingsRow,
    drawingDirections: ['back', 'front', 'back'],
    drawingGrayscale: false,
  };
  const queries: string[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push(sql);
      if (sql.includes('FROM theme_jobs'))
        return { rows: [{ input, sourceAssetId: 'theme-asset', versionId: 'theme-version', objectKey: 'theme.png', checksum: 'x' }] };
      if (sql.includes('FROM ai_model_assignments')) return { rows: [assignedRow('qwen-image', 'artwork', { unitCredits: 5 })] };
      if (sql.includes('FROM dictionary_items') || sql.includes('FROM prompt_templates')) return { rows: [] };
      if (sql.includes('FROM artwork_generation_settings')) return { rows: [settings] };
      if (sql.includes("a.type = 'drawing'")) {
        assert.deepEqual(params, ['SCHEME']);
        return { rows: drawingRows };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;
  const context = { schemeCode: 'SCHEME', themeJobId: 'theme-job', resultId: 'theme-result', selectionRevision: 1 };
  const snapshot = await loadArtworkSnapshot(pool, 'user', context);
  assert.deepEqual(snapshot.options, { drawingDirections: ['front', 'back'], drawingGrayscale: false });
  assert.deepEqual(Object.keys(snapshot.drawings ?? {}), ['front', 'back']);
  assert.deepEqual(summary(snapshot.drawings?.back), ['top:version-top:top', 'elevation:version-front:front:mirrored']);
  assert.match(snapshot.directionPrompts!.back, /背面轮廓：由正视图水平翻转得到/);
  assert.doesNotMatch(snapshot.directionPrompts!.back, /已去色/);
  assert.match(snapshot.directionPrompts!.left, /唯一一张主题效果参考图/);

  settings = { ...artworkSettingsRow, drawingDirections: [] };
  queries.length = 0;
  const disabled = await loadArtworkSnapshot(pool, 'user', context);
  assert.deepEqual(disabled.drawings, {});
  assert.ok(!queries.some(sql => sql.includes("a.type = 'drawing'")));
});
