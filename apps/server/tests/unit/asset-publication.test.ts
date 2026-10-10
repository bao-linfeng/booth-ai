import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { addAssetVersion, createAssetWithVersion, deleteAsset, updateAsset } from '../../src/modules/assets/service.js';

test('new assets without an explicit sort order follow existing assets', async () => {
  let insertedValues: unknown[] | undefined;
  const asset = {
    id: 'asset-id', schemeId: 'scheme-id', schemeCode: 'S-1', schemeName: '方案', type: 'rendering',
    name: '图', sortOrder: 2, relatedAssetId: null, metadata: {}, isActive: true, revision: 1,
    createdAt: new Date(), updatedAt: new Date(), versionId: null,
  };
  const query = async (sql: string, params?: unknown[]) => {
    if (sql.includes('SELECT id::text AS id FROM schemes')) return { rows: [{ id: 'scheme-id' }] };
    if (sql.includes('MAX(sort_order)')) return { rows: [{ sortOrder: 1 }] };
    if (sql.includes('INSERT INTO scheme_baseline_assets')) {
      insertedValues = params;
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO asset_versions')) return { rows: [{ id: 'version-id', assetId: 'asset-id', objectKey: 'object', originalFilename: 'image.png', mimeType: 'image/png', byteSize: 1, checksum: 'hash', widthPx: 1600, heightPx: 900, pageCount: null, createdAt: new Date() }] };
    if (sql.includes('FROM scheme_baseline_assets sa')) return { rows: [asset] };
    return { rows: [], rowCount: 1 };
  };
  const pool = { connect: async () => ({ query, release: () => {} }) } as unknown as pg.Pool;

  await createAssetWithVersion(pool, null, {
    schemeCode: 'S-1', type: 'rendering', name: '图',
  }, {
    objectKey: 'object', originalFilename: 'image.png', mimeType: 'image/png', byteSize: 1, checksum: 'hash', widthPx: 1600, heightPx: 900,
  });

  assert.equal(insertedValues?.[4], 2);
});

test('replacing a logical asset adds a version and atomically retracts a published scheme', async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT id::text AS id FROM schemes')) return { rows: [{ id: 'scheme-id' }] };
      if (sql.includes('FROM scheme_baseline_assets sa')) return { rows: [{
        id: 'asset-id', schemeId: 'scheme-id', schemeCode: 'S-1', schemeName: '方案', type: 'rendering',
        name: '图', sortOrder: 0, relatedAssetId: null, metadata: {}, isActive: true, revision: 1,
        createdAt: new Date(), updatedAt: new Date(), versionId: null,
      }] };
      if (sql.includes('INSERT INTO asset_versions')) return { rows: [{ id: 'version-id', assetId: 'asset-id', objectKey: 'object', originalFilename: 'image.png', mimeType: 'image/png', byteSize: 1, checksum: 'hash', widthPx: 1600, heightPx: 900, pageCount: null, createdAt: new Date() }] };
      if (sql.includes('UPDATE scheme_baseline_assets')) return { rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  const version = await addAssetVersion(pool, null, 'S-1', 'asset-id', {
    objectKey: 'object', originalFilename: 'image.png', mimeType: 'image/png', byteSize: 1, checksum: 'hash', widthPx: 1600, heightPx: 900,
  }, 1);
  assert.equal(version.assetId, 'asset-id');
  assert.ok(queries.some(sql => sql.includes('SELECT id::text AS id FROM schemes') && sql.includes('FOR UPDATE')));
  assert.ok(queries.some(sql => sql.includes('INSERT INTO asset_versions')));
  assert.ok(queries.some(sql => sql.includes("publish_status='draft'") && sql.includes("verification_status='unverified'")));
  assert.ok(queries.includes('COMMIT'));
});

test('removing a non-model asset also retracts published schemes in the same transaction', async () => {
  const queries: string[] = [];
  const asset = { id: 'asset-id', schemeId: 'scheme-id', schemeCode: 'S-1', schemeName: '方案', type: 'rendering', name: '图', sortOrder: 0, relatedAssetId: null, metadata: {}, isActive: true, revision: 1, createdAt: new Date(), updatedAt: new Date(), versionId: null };
  const query = async (sql: string) => {
    queries.push(sql);
    if (sql.includes('FROM scheme_baseline_assets sa')) return { rows: [asset] };
    if (sql.includes('SELECT id::text AS id FROM schemes')) return { rows: [{ id: 'scheme-id' }] };
    if (sql.includes("type = 'mask' AND related_asset_id")) return { rows: [], rowCount: 0 };
    if (sql.includes('UPDATE scheme_baseline_assets')) return { rows: [{ revision: 2 }] };
    return { rows: [], rowCount: 1 };
  };
  const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as pg.Pool;
  assert.equal(await deleteAsset(pool, null, 'S-1', 'asset-id', 1), 2);
  assert.ok(queries.some(sql => sql.includes("publish_status='draft'")));
  assert.ok(queries.includes('COMMIT'));
});

test('deleting a rendering with an active paired mask is rejected unless the pair is removed together', async () => {
  const asset = { id: 'rendering-id', schemeId: 'scheme-id', schemeCode: 'S-1', schemeName: '方案', type: 'rendering', name: '图', sortOrder: 0, relatedAssetId: null, metadata: {}, isActive: true, revision: 1, createdAt: new Date(), updatedAt: new Date(), versionId: null };
  function poolRecording(queries: string[]) {
    const query = async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM scheme_baseline_assets sa')) return { rows: [asset] };
      if (sql.includes('SELECT id::text AS id FROM schemes')) return { rows: [{ id: 'scheme-id' }] };
      if (sql.includes('UPDATE scheme_baseline_assets')) return { rows: [{ revision: 2 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    };
    return { query, connect: async () => ({ query, release: () => {} }) } as unknown as pg.Pool;
  }

  const rejected: string[] = [];
  await assert.rejects(deleteAsset(poolRecording(rejected), null, 'S-1', 'rendering-id', 1), { statusCode: 409, reason: 'RENDERING_HAS_PAIRED_MASK' });
  assert.ok(rejected.includes('ROLLBACK'));
  assert.ok(!rejected.some(sql => sql.includes('UPDATE scheme_baseline_assets')));

  const removed: string[] = [];
  assert.equal(await deleteAsset(poolRecording(removed), null, 'S-1', 'rendering-id', 1, { withPairedMasks: true }), 2);
  assert.ok(removed.some(sql => sql.includes('UPDATE scheme_baseline_assets') && sql.includes("type = 'mask' AND related_asset_id")));
  assert.ok(removed.includes('COMMIT'));
});

test('changing a rendering sort order also updates its paired masks', async () => {
  const queries: string[] = [];
  const asset = {
    id: 'rendering-id', schemeId: 'scheme-id', schemeCode: 'S-1', schemeName: '方案', type: 'rendering',
    name: '效果图', sortOrder: 0, relatedAssetId: null, metadata: {}, isActive: true, revision: 1,
    createdAt: new Date(), updatedAt: new Date(), versionId: null,
  };
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT id::text AS id FROM schemes')) return { rows: [{ id: 'scheme-id' }] };
      if (sql.includes('FROM scheme_baseline_assets sa')) return { rows: [asset] };
      if (sql.includes('SELECT 1 FROM scheme_baseline_assets')) return { rowCount: 0, rows: [] };
      if (sql.includes("type = 'mask' AND related_asset_id")) return { rowCount: 1, rows: [] };
      if (sql.includes('UPDATE scheme_baseline_assets')) return { rowCount: 1, rows: [] };
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  };
  const pool = {
    query: client.query,
    connect: async () => client,
  } as unknown as pg.Pool;

  await updateAsset(pool, null, 'S-1', 'rendering-id', { sortOrder: 3 }, 1);

  assert.ok(queries.some(sql => sql.includes("type = 'mask' AND related_asset_id")));
  assert.ok(queries.some(sql => sql.includes('sort_order = $1')));
});
