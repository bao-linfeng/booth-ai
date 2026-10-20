import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { signImage, signImageLinks } from '../../src/modules/media/links.js';
import { createRenditions, renditionKey } from '../../src/modules/media/renditions.js';

function memoryStorage() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    async putBuffer(key: string, body: Buffer | Uint8Array, contentType: string) {
      objects.set(key, { body: Buffer.from(body), contentType });
    },
  };
}

test('renditions keep aspect ratio, transparency and orientation without enlarging small sources', async () => {
  const storage = memoryStorage();
  const transparent = await sharp({
    create: {
      width: 2000,
      height: 1000,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const renditions = await createRenditions(storage, 'schemes/A/rendering/a.png', transparent);
  assert.deepEqual(
    {
      thumb: [renditions.thumb.width, renditions.thumb.height],
      preview: [renditions.preview.width, renditions.preview.height],
    },
    { thumb: [480, 240], preview: [1600, 800] },
  );
  assert.equal(renditions.thumb.key, 'renditions/v1/schemes/A/rendering/a.png/thumb.webp');
  for (const rendition of Object.values(renditions)) {
    const stored = storage.objects.get(rendition.key)!;
    assert.equal(stored.contentType, 'image/webp');
    assert.equal(stored.body.byteLength, rendition.bytes);
    const metadata = await sharp(stored.body).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.hasAlpha, true);
  }

  const small = await sharp({
    create: { width: 300, height: 200, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toBuffer();
  const unscaled = await createRenditions(storage, 'small.jpg', small);
  assert.deepEqual([unscaled.preview.width, unscaled.preview.height, unscaled.thumb.width], [300, 200, 300]);

  // EXIF 方向 6（顺时针 90°）：宽高互换后再缩放
  const rotated = await sharp({
    create: { width: 1000, height: 500, channels: 3, background: '#000' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const oriented = await createRenditions(storage, 'rotated.jpg', rotated);
  assert.deepEqual([oriented.thumb.width, oriented.thumb.height], [240, 480]);
});

test('display links use renditions when present and fall back to the original otherwise', async () => {
  const storage = { signDownload: async (key: string) => `signed:${key}` };
  const renditions = {
    thumb: { key: renditionKey('a.png', 'thumb'), width: 480, height: 270, bytes: 1 },
    preview: { key: renditionKey('a.png', 'preview'), width: 1600, height: 900, bytes: 1 },
  };
  assert.equal(await signImage(storage, { objectKey: 'a.png', renditions }, 'thumb', 300), `signed:${renditions.thumb.key}`);
  assert.deepEqual(await signImageLinks(storage, { objectKey: 'a.png', renditions }, 900), {
    thumbnailUrl: `signed:${renditions.thumb.key}`,
    previewUrl: `signed:${renditions.preview.key}`,
  });
  assert.deepEqual(await signImageLinks(storage, { objectKey: 'b.png', renditions: null }, 300), {
    thumbnailUrl: 'signed:b.png',
    previewUrl: 'signed:b.png',
  });
});
