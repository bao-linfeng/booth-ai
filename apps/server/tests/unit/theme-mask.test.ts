import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { editableMap, toEditMask } from '../../src/modules/generation/theme/mask.js';
import { themeEditInput } from '../../src/modules/generation/theme/source.js';
import { LEGACY_THEME_OPTIONS } from '../../src/modules/generation/theme/settings.js';

/** 4×1 蒙版：不透明品红、透明品红（导出工具常见）、不透明白、透明白。 */
async function maskFixture() {
  const pixels = Buffer.from([255, 0, 255, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255, 255, 255, 0]);
  return sharp(pixels, { raw: { width: 4, height: 1, channels: 4 } })
    .png()
    .toBuffer();
}

test('edit mask only opens opaque magenta pixels; transparent magenta background stays protected', async () => {
  const { data } = await sharp(await toEditMask(await maskFixture()))
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([data[3], data[7], data[11], data[15]], [0, 255, 255, 255]);
  assert.deepEqual([...(await editableMap(await maskFixture(), 4, 1))], [255, 0, 0, 0]);
});

test('theme edit input applies background fill and mask switch from the frozen options', async () => {
  const original = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
  const mask = await maskFixture();

  const legacy = await themeEditInput({ original, mask }, LEGACY_THEME_OPTIONS);
  assert.equal(legacy.reference, original);
  assert.ok(legacy.mask);

  const filled = await themeEditInput(
    { original, mask },
    { sendMask: false, composite: false, backgroundMode: 'fill', backgroundColor: '#E8EAEE' },
  );
  assert.equal(filled.mask, undefined);
  const { data, info } = await sharp(filled.reference).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  assert.deepEqual([...data.subarray(0, 3)], [0xe8, 0xea, 0xee]);
});
