import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import sharp from 'sharp';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import type { createStorage } from '../../src/infra/storage.js';
import type { Principal } from '../../src/modules/identity/principal.js';
import { registerAdminAssetsRoutes } from '../../src/http/admin/assets/index.js';
import { uploadAsset, uploadAssetVersion, type AssetUploadFile } from '../../src/modules/assets/upload.js';
import { createAssetWithVersion, updateAsset } from '../../src/modules/assets/service.js';
import { validateAssetMetadata } from '../../src/modules/assets/metadata.js';
import { allPermissionCodes } from '../../src/modules/identity/permissions.js';

function dependencies(options: {
  saveError?: Error; storageError?: Error; cleanupError?: Error; revision?: number;
  assetType?: 'rendering' | 'mask'; renderingSize?: { widthPx: number; heightPx: number } | null;
} = {}) {
  const events: string[] = [];
  const objects = new Map<string, Buffer | Uint8Array>();
  let versionValues: unknown[] = [];
  const asset = {
    id: 'asset-id', schemeId: 'scheme-id', schemeCode: 'S-1', schemeName: '方案', type: options.assetType ?? 'rendering',
    name: '效果图', sortOrder: 0, relatedAssetId: options.assetType === 'mask' ? 'rendering-id' : null, metadata: {},
    isActive: true, revision: options.revision ?? 1, createdAt: new Date(), updatedAt: new Date(), versionId: null,
  };
  const query = async (sql: string, values: unknown[] = []) => {
    events.push(sql);
    if (sql.includes('SELECT id::text AS id FROM schemes')) return { rows: [{ id: 'scheme-id' }] };
    if (sql.includes('FROM scheme_baseline_assets sa')) return { rows: [asset] };
    if (sql.includes("type = 'rendering' AND is_active = true")) return { rows: [{ type: 'rendering' }], rowCount: 1 };
    if (sql.includes("type = 'mask' AND related_asset_id")) return { rows: [], rowCount: 0 };
    if (sql.includes('SELECT width_px')) return { rows: options.renderingSize ? [options.renderingSize] : [] };
    if (sql.includes('MAX(sort_order)')) return { rows: [{ sortOrder: null }] };
    if (sql.includes('INSERT INTO asset_versions')) {
      if (options.saveError) throw options.saveError;
      versionValues = values;
      return { rows: [{ id: values[0], assetId: values[1], objectKey: values[2], originalFilename: values[3],
        mimeType: values[4], byteSize: String(values[5]), checksum: values[6], widthPx: values[7], heightPx: values[8],
        pageCount: values[9], createdAt: new Date() }] };
    }
    return { rows: [], rowCount: 1 };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as pg.Pool;
  const storage = {
    async putBuffer(key: string, body: Buffer | Uint8Array) {
      events.push('put');
      if (options.storageError) throw options.storageError;
      objects.set(key, body);
    },
    async deleteObject(key: string) {
      events.push('delete');
      if (options.cleanupError) throw options.cleanupError;
      objects.delete(key);
    },
  };
  return { pool, storage, events, objects, versionValues: () => versionValues };
}

async function sizedImage(width: number, height: number): Promise<AssetUploadFile> {
  const buffer = await sharp({ create: { width, height, channels: 3, background: '#000000' } }).png().toBuffer();
  return { buffer, originalFilename: 'image.png', mimeType: 'image/png' };
}

async function imageFile(format: 'png' | 'jpeg' | 'webp', lossless = false): Promise<AssetUploadFile> {
  const image = sharp({ create: { width: 16, height: 9, channels: 3, background: '#ff0000' } });
  const buffer = await (format === 'webp' ? image.webp({ lossless }) : image.toFormat(format)).toBuffer();
  return { buffer, originalFilename: `image.${format}`, mimeType: `image/${format}` };
}

test('asset uploads persist image dimensions, original bytes and digest for supported formats', async t => {
  for (const [format, lossless] of [['png', false], ['jpeg', false], ['webp', false], ['webp', true]] as const) {
    await t.test(`${format}${lossless ? ' lossless' : ''}`, async () => {
      const deps = dependencies();
      const file = await imageFile(format, lossless);
      await uploadAsset(deps.pool, deps.storage, null, { schemeCode: 'S-1', type: 'rendering', name: '效果图' }, file);
      const values = deps.versionValues();
      assert.match(String(values[2]), /^schemes\/S-1\/rendering\//);
      assert.deepEqual(values.slice(3, 10), [file.originalFilename, file.mimeType, file.buffer.length,
        createHash('sha256').update(file.buffer).digest('hex'), 16, 9, null]);
      assert.deepEqual([...deps.objects.values()], [file.buffer]);
      assert.ok(deps.events.indexOf('put') < deps.events.indexOf('BEGIN'));
      assert.ok(deps.events.includes('COMMIT'));
      assert.ok(!deps.events.includes('delete'));
    });
  }
});

test('invalid, mismatched and unsupported rendering images are rejected before storage or DB writes', async () => {
  const valid = await imageFile('png');
  const files = [
    { ...valid, buffer: Buffer.from('invalid image') },
    { ...valid, buffer: valid.buffer.subarray(0, 24) },
    { ...valid, mimeType: 'image/jpeg' },
    { ...valid, mimeType: 'image/gif' },
  ];
  for (const file of files) {
    const deps = dependencies();
    await assert.rejects(uploadAsset(deps.pool, deps.storage, null,
      { schemeCode: 'S-1', type: 'rendering', name: '效果图' }, file), { statusCode: 400, message: 'Unsupported or invalid image' });
    assert.deepEqual(deps.events, []);
  }
});

test('rendering uploads and replacements require an exact 16:9 image before storage', async t => {
  for (const existing of [false, true]) {
    await t.test(`existing=${existing}`, async () => {
      const deps = dependencies();
      const upload = (file: AssetUploadFile) => existing
        ? uploadAssetVersion(deps.pool, deps.storage, null, 'S-1', 'asset-id', file, 1)
        : uploadAsset(deps.pool, deps.storage, null, { schemeCode: 'S-1', type: 'rendering', name: '效果图' }, file);
      await assert.rejects(upload(await sizedImage(1600, 901)),
        { statusCode: 400, reason: 'RENDERING_ASPECT_INVALID', message: 'Rendering must be exactly 16:9' });
      assert.ok(!deps.events.includes('put') && !deps.events.includes('BEGIN'));
      await upload(await sizedImage(1600, 900));
      assert.deepEqual(deps.versionValues().slice(7, 9), [1600, 900]);
    });
  }
});

test('mask uploads and replacements must match the paired rendering pixel size', async t => {
  const input = { schemeCode: 'S-1', type: 'mask' as const, name: '蒙版', relatedAssetId: 'rendering-id' };
  for (const existing of [false, true]) {
    await t.test(`existing=${existing}`, async () => {
      const deps = dependencies({ assetType: 'mask', renderingSize: { widthPx: 1600, heightPx: 900 } });
      const upload = (file: AssetUploadFile) => existing
        ? uploadAssetVersion(deps.pool, deps.storage, null, 'S-1', 'asset-id', file, 1)
        : uploadAsset(deps.pool, deps.storage, null, input, file);
      await assert.rejects(upload(await sizedImage(800, 450)), { statusCode: 400, reason: 'MASK_SIZE_MISMATCH' });
      assert.ok(deps.events.includes('ROLLBACK'));
      assert.ok(!deps.events.some(sql => sql.includes('INSERT INTO asset_versions')));
      assert.equal(deps.objects.size, 0);
      await upload(await sizedImage(1600, 900));
      assert.deepEqual(deps.versionValues().slice(7, 9), [1600, 900]);
    });
  }
  const deps = dependencies({ assetType: 'mask', renderingSize: null });
  await assert.rejects(uploadAsset(deps.pool, deps.storage, null, input, await sizedImage(1600, 900)),
    { statusCode: 400, reason: 'RENDERING_FILE_MISSING' });
  assert.equal(deps.objects.size, 0);
});

test('non-image assets keep accepting arbitrary files without image dimensions', async () => {
  const deps = dependencies();
  await uploadAsset(deps.pool, deps.storage, null, { schemeCode: 'S-1', type: 'model', name: '模型' },
    { buffer: Buffer.from('model'), originalFilename: 'model.glb', mimeType: 'application/octet-stream' });
  assert.deepEqual(deps.versionValues().slice(7, 10), [null, null, null]);
});

test('both upload entry points compensate failed transactions and preserve the original error', async t => {
  const file = await imageFile('png');
  for (const existing of [false, true]) {
    for (const failCleanup of [false, true]) {
      await t.test(`existing=${existing}, cleanup failure=${failCleanup}`, async () => {
        const saveError = new Error('database write failed');
        const deps = dependencies({ saveError, ...(failCleanup ? { cleanupError: new Error('storage cleanup failed') } : {}) });
        await assert.rejects(existing
          ? uploadAssetVersion(deps.pool, deps.storage, null, 'S-1', 'asset-id', file, 1)
          : uploadAsset(deps.pool, deps.storage, null, { schemeCode: 'S-1', type: 'rendering', name: '效果图' }, file),
        error => error === saveError);
        assert.ok(deps.events.includes('ROLLBACK'));
        assert.ok(!deps.events.includes('COMMIT'));
        assert.equal(deps.events.at(-1), 'delete');
        assert.equal(deps.objects.size, failCleanup ? 1 : 0);
      });
    }
  }
});

test('storage write failure does not enter a transaction', async () => {
  const storageError = new Error('upload failed');
  const deps = dependencies({ storageError });
  await assert.rejects(uploadAsset(deps.pool, deps.storage, null,
    { schemeCode: 'S-1', type: 'rendering', name: '效果图' }, await imageFile('png')), error => error === storageError);
  assert.deepEqual(deps.events, ['put']);
});

test('stale version upload removes the uploaded object without inserting a version or retracting publication', async () => {
  const deps = dependencies({ revision: 2 });
  await assert.rejects(uploadAssetVersion(deps.pool, deps.storage, null, 'S-1', 'asset-id', await imageFile('png'), 1),
    { statusCode: 409, message: 'Asset revision conflict' });
  assert.equal(deps.objects.size, 0);
  assert.ok(deps.events.includes('ROLLBACK'));
  assert.ok(!deps.events.some(sql => sql.includes('INSERT INTO asset_versions') || sql.includes('UPDATE schemes')));
});

test('new version upload returns mapped version and retains its object after commit', async () => {
  const deps = dependencies();
  const file = await imageFile('png');
  const version = await uploadAssetVersion(deps.pool, deps.storage, null, 'S-1', 'asset-id', file, 1);
  assert.equal(version.assetId, 'asset-id');
  assert.equal(version.byteSize, file.buffer.length);
  assert.equal(version.widthPx, 16);
  assert.equal(version.heightPx, 9);
  assert.ok(deps.objects.has(version.objectKey));
  assert.ok(deps.events.includes('COMMIT'));
  assert.ok(deps.events.some(sql => sql.includes("publish_status='draft'")));
});

test('metadata rules and required upload pairing are enforced outside HTTP', async () => {
  const deps = dependencies();
  const file = await imageFile('png');
  for (const input of [
    { schemeCode: 'S-1', type: 'artwork' as const, name: '画稿' },
    { schemeCode: 'S-1', type: 'mask' as const, name: '蒙版' },
  ]) await assert.rejects(uploadAsset(deps.pool, deps.storage, null, input, file), { statusCode: 400 });
  await assert.rejects(createAssetWithVersion(deps.pool, null, { schemeCode: 'S-1', type: 'artwork', name: '画稿' },
    { objectKey: 'key', originalFilename: 'a.png', mimeType: 'image/png', byteSize: 1, checksum: 'hash' }), { statusCode: 400 });
  assert.deepEqual(deps.events, []);
  for (const metadata of [{ viewCodes: [1] }, { purpose: 1 }, { modelAssetVersionId: 'bad' }]) {
    assert.throws(() => validateAssetMetadata('drawing', metadata), { statusCode: 400 });
  }
  for (const metadata of [{ physicalWidth: 0 }, { dimensionUnit: 'inch' }, { wallPosition: 1 }]) {
    assert.throws(() => validateAssetMetadata('artwork', { artworkKey: 'front', ...metadata }), { statusCode: 400 });
  }
  validateAssetMetadata('drawing', { viewCodes: ['front'], purpose: '施工' });
  validateAssetMetadata('artwork', { artworkKey: 'front', physicalWidth: 100, dimensionUnit: 'mm' });
});

test('metadata-only update on other asset types still follows the normal transaction', async () => {
  const deps = dependencies();
  await updateAsset(deps.pool, null, 'S-1', 'asset-id', { metadata: { description: '效果图' } }, 1);
  assert.ok(deps.events.includes('COMMIT'));
});

function multipartBody(fields: Record<string, string>, files: AssetUploadFile[], fileFirst = false): Buffer {
  const fieldParts = Object.entries(fields).map(([name, value]) => Buffer.from(
    `--asset-boundary\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  ));
  const fileParts = files.map(file => Buffer.concat([
    Buffer.from(`--asset-boundary\r\nContent-Disposition: form-data; name="file"; filename="${file.originalFilename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
    file.buffer, Buffer.from('\r\n'),
  ]));
  return Buffer.concat([...(fileFirst ? [...fileParts, ...fieldParts] : [...fieldParts, ...fileParts]), Buffer.from('--asset-boundary--\r\n')]);
}

test('admin upload routes share multipart parsing for either field order and reject invalid requests before writes', async t => {
  const deps = dependencies();
  const app = Fastify();
  t.after(() => app.close());
  await app.register(multipart);
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async request => {
    request.principal = { site: 'admin', localId: 'admin-id', permissions: allPermissionCodes } as Principal;
  });
  await registerAdminAssetsRoutes(app, deps.pool, deps.storage as unknown as ReturnType<typeof createStorage>);
  const file = await imageFile('png');
  const versionUrl = '/schemes/S-1/assets/123e4567-e89b-42d3-a456-426614174000/versions';
  for (const fileFirst of [false, true]) {
    for (const [url, fields] of [
      ['/schemes/S-1/assets', { type: 'rendering', name: '效果图', metadata: '{"description":"test"}' }],
      [versionUrl, { expectedRevision: '1' }],
    ] as const) {
      const response = await app.inject({ method: 'POST', url,
        headers: { 'content-type': 'multipart/form-data; boundary=asset-boundary' },
        payload: multipartBody(fields, [file], fileFirst) });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().code, 0);
    }
  }
  const invalidRequests: Array<{ url: string; fields: Record<string, string>; files: AssetUploadFile[]; message: string }> = [
    { url: '/schemes/S-1/assets', fields: { type: 'rendering', name: '效果图' }, files: [], message: 'File is required' },
    { url: '/schemes/S-1/assets', fields: { type: 'rendering', name: '效果图' }, files: [file, file], message: 'Only one file is allowed' },
    { url: '/schemes/S-1/assets', fields: { type: 'drawing', name: '图纸', metadata: '[]' }, files: [file], message: 'Metadata must be a JSON object' },
    { url: '/schemes/S-1/assets', fields: { type: 'artwork', name: '画稿' }, files: [file], message: 'artwork metadata.artworkKey is required' },
    { url: '/schemes/S-1/assets', fields: { type: 'mask', name: '蒙版' }, files: [file], message: 'relatedAssetId is required for mask assets' },
    { url: '/schemes/S-1/assets', fields: { type: 'rendering', name: '效果图', idempotencyKey: 'retry-1' }, files: [file], message: 'idempotencyKey must be a valid UUID' },
    { url: versionUrl, fields: { expectedRevision: '0' }, files: [file], message: 'expectedRevision is required' },
    { url: versionUrl, fields: { expectedRevision: '1.5' }, files: [file], message: 'expectedRevision must be an integer' },
  ];
  for (const { url, fields, files, message } of invalidRequests) {
    deps.events.length = 0;
    const response = await app.inject({ method: 'POST', url,
      headers: { 'content-type': 'multipart/form-data; boundary=asset-boundary' }, payload: multipartBody(fields, files) });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().message, message);
    assert.ok(deps.events.every(sql => sql.includes('FROM scheme_baseline_assets sa')), 'invalid requests must not write to storage or the database');
  }
});

test('deleting a rendering together with its paired masks also requires the mask delete permission', async t => {
  const deps = dependencies();
  const app = Fastify();
  t.after(() => app.close());
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async request => {
    request.principal = { site: 'admin', localId: 'admin-id', permissions: allPermissionCodes.filter(code => code !== 'assets-masks.delete') } as Principal;
  });
  await registerAdminAssetsRoutes(app, deps.pool, deps.storage as unknown as ReturnType<typeof createStorage>);
  const url = '/schemes/S-1/assets/123e4567-e89b-42d3-a456-426614174000';

  const forbidden = await app.inject({ method: 'DELETE', url, payload: { expectedRevision: 1, withPairedMasks: true } });
  assert.equal(forbidden.statusCode, 403, forbidden.body);
  assert.ok(deps.events.every(sql => sql.includes('FROM scheme_baseline_assets sa')), 'forbidden requests must not write to the database');
});

test('mask pairing candidates list renderings with size, order and occupying mask, signing thumbnails only with preview permission', async t => {
  const row = (id: string, type: 'rendering' | 'mask', sortOrder: number, relatedAssetId: string | null, version: boolean) => ({
    id, schemeId: 'scheme-id', schemeCode: 'S-1', schemeName: '方案', type, name: `${type}-${id}`, sortOrder, relatedAssetId,
    metadata: {}, isActive: true, revision: 4, createdAt: new Date(), updatedAt: new Date(),
    versionId: version ? `v-${id}` : null, versionAssetId: version ? id : null, versionObjectKey: version ? `key/${id}` : null,
    versionOriginalFilename: version ? `${id}.png` : null, versionMimeType: version ? 'image/png' : null, versionByteSize: version ? 10 : null,
    versionChecksum: version ? 'c' : null, versionWidthPx: version ? 1600 : null, versionHeightPx: version ? 900 : null,
    versionPageCount: null, versionCreatedAt: version ? new Date() : null,
  });
  const pool = { query: async (_sql: string, values: unknown[]) => ({
    rows: values[1] === 'rendering' ? [row('r1', 'rendering', 0, null, true), row('r2', 'rendering', 1, null, false)] : [row('m1', 'mask', 0, 'r1', true)],
  }) } as unknown as pg.Pool;
  const signed: string[] = [];
  const storage = { signDownload: async (key: string) => { signed.push(key); return `https://cdn.test/${key}`; } };
  async function request(permissions: string[]) {
    const app = Fastify();
    t.after(() => app.close());
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async req => { req.principal = { site: 'admin', localId: 'admin-id', permissions } as Principal; });
    await registerAdminAssetsRoutes(app, pool, storage as unknown as ReturnType<typeof createStorage>);
    return app.inject({ method: 'GET', url: '/schemes/S-1/assets/mask-candidates' });
  }

  const full = await request(allPermissionCodes);
  assert.equal(full.statusCode, 200, full.body);
  assert.deepEqual(full.json().data, [
    { id: 'r1', name: 'rendering-r1', sortOrder: 0, file: { originalFilename: 'r1.png', widthPx: 1600, heightPx: 900 },
      thumbnailUrl: 'https://cdn.test/key/r1', pairedMask: { id: 'm1', name: 'mask-m1', revision: 4 } },
    { id: 'r2', name: 'rendering-r2', sortOrder: 1, file: null, thumbnailUrl: null, pairedMask: null },
  ]);
  assert.deepEqual(signed, ['key/r1']);

  const noPreview = await request(allPermissionCodes.filter(code => code !== 'assets-renderings.preview'));
  assert.equal(noPreview.json().data[0].thumbnailUrl, null);
  assert.equal(signed.length, 1);

  const readOnly = await request(allPermissionCodes.filter(code => code !== 'assets-masks.upload' && code !== 'assets-masks.update'));
  assert.equal(readOnly.statusCode, 403);
});
