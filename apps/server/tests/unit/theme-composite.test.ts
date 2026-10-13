import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { compositeThemeResult } from '../../src/modules/generation/theme/composite.js';

const W = 640;
const H = 360;
const PANELS = [
  [150, 70, 160, 170],
  [330, 90, 150, 150],
  [500, 110, 50, 120],
] as const;

/** 透明背景上的简化展台：铝框、立柱、桌椅为结构（不可编辑），三块面板为画面（可编辑）。 */
function booth(panelFill: string, transform = '', background = '') {
  const panels = PANELS.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${panelFill}"/>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${background}
    <defs><pattern id="new" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#F08C00"/><rect width="6" height="6" fill="#C2410C"/></pattern></defs>
    <g transform="${transform}">
      <rect x="130" y="50" width="440" height="230" fill="none" stroke="#9AA0A6" stroke-width="10"/>
      <rect x="315" y="60" width="10" height="220" fill="#6B7280"/>
      ${panels}
      <rect x="200" y="250" width="120" height="40" fill="#FFFFFF" stroke="#333" stroke-width="3"/>
      <circle cx="380" cy="270" r="14" fill="#1F2937"/><circle cx="430" cy="270" r="14" fill="#1F2937"/>
      <rect x="110" y="290" width="480" height="18" fill="#4B5563"/>
      <line x1="160" y1="20" x2="200" y2="50" stroke="#222" stroke-width="4"/><line x1="480" y1="20" x2="440" y2="50" stroke="#222" stroke-width="4"/>
    </g></svg>`);
}

const png = (svg: Buffer) => sharp(svg).png().toBuffer();
const around = (dx: number, dy: number, scaleX: number, scaleY = scaleX) =>
  `translate(${W / 2 + dx} ${H / 2 + dy}) scale(${scaleX} ${scaleY}) translate(${-W / 2} ${-H / 2})`;
const studio = '<rect width="100%" height="100%" fill="#E8EAEE"/>';

async function pixel(image: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const { data } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * W + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
}

test('composite aligns a zoomed and shifted result, keeps structure and transparent background from the original', async () => {
  const original = await png(booth('#1D4ED8'));
  const generated = await png(booth('#F08C00', around(12, -18, 1.06), studio));

  const result = await compositeThemeResult(original, await png(booth('#FF00FF')), generated);
  assert.ok(!('skipped' in result), 'alignment should be reliable');
  assert.ok(Math.abs(result.alignment.scale - 1.06) <= 0.01, `scale ${result.alignment.scale}`);
  assert.ok(Math.abs(result.alignment.dx - 12) <= 4, `dx ${result.alignment.dx}`);
  assert.ok(Math.abs(result.alignment.dy + 18) <= 4, `dy ${result.alignment.dy}`);
  assert.equal(result.width, W);
  assert.equal(result.height, H);

  assert.equal((await pixel(result.bytes, 10, 10))[3], 0, 'background stays transparent');
  assert.deepEqual(await pixel(result.bytes, 380, 270), await pixel(original, 380, 270), 'structure comes from the original');
  const [r, g, b, a] = await pixel(result.bytes, 230, 150);
  assert.equal(a, 255);
  assert.ok(r > 180 && g > 50 && b < 60, `panel shows the new theme, got ${[r, g, b]}`);
});

test('composite is skipped when the result is distorted beyond a uniform zoom and shift', async () => {
  const original = await png(booth('#1D4ED8'));
  const generated = await png(booth('url(#new)', around(0, 0, 1, 1.25), studio));
  const result = await compositeThemeResult(original, await png(booth('#FF00FF')), generated);
  assert.ok('skipped' in result);
  assert.equal(result.skipped.reliable, false);
});
