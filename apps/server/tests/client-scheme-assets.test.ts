import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import Fastify from 'fastify';
import type { createStorage } from '../src/infra/storage.js';
import { registerClientSchemeAssetRoutes } from '../src/modules/client/schemes/index.js';

const assetId = '123e4567-e89b-42d3-a456-426614174000';
function setup(options: { published?: boolean; empty?: boolean } = {}) {
  const queries: string[] = [];
  const pool = { query: async (sql: string, params?: unknown[]) => {
    queries.push(sql);
    if (sql.includes('SELECT 1 FROM schemes')) return { rows: options.published === false ? [] : [{ '?column?': 1 }] };
    if (sql.includes('FROM schemes s')) return { rows: options.empty ? [] : [{ assetId, name: '平面图', sortOrder: 1,
      originalFilename: '平面图.pdf', mimeType: 'application/pdf', byteSize: 1024,
      objectKey: 'private/key' }] };
    throw new Error(`Unexpected SQL ${sql}`);
  } } as unknown as pg.Pool;
  const storage = { signDownload: async (key: string) => {
    assert.equal(key, 'private/key');
    return 'http://localhost:19000/preview';
  }, signDownloadWithName: async (key: string, filename: string) => {
    assert.equal(key, 'private/key');
    assert.equal(filename, '平面图.pdf');
    return 'http://localhost:19000/signed';
  } } as unknown as ReturnType<typeof createStorage>;
  return { pool, storage, queries };
}

test('published scheme deliverables are accessible anonymously without exposing object keys', async t => {
  const deps = setup();
  const app = Fastify();
  t.after(() => app.close());
  await registerClientSchemeAssetRoutes(app, deps.pool, deps.storage);
  const anonymous = await app.inject('/schemes/S-1/drawings');
  assert.equal(anonymous.statusCode, 200);
  assert.equal(anonymous.headers['cache-control'], 'no-store');
  assert.equal(anonymous.json().data.items[0].name, '平面图');
  assert.ok(!anonymous.body.includes('private/key'));
  assert.ok(!deps.queries.some(sql => sql.includes('FROM users')));
  assert.ok(deps.queries.some(sql => sql.includes("s.publish_status = 'published'")));
});

test('anonymous downloads validate publication and asset membership', async t => {
  const deps = setup();
  const app = Fastify();
  t.after(() => app.close());
  await registerClientSchemeAssetRoutes(app, deps.pool, deps.storage);
  assert.equal((await app.inject('/schemes/S-1/model/download')).json().data.filename, '平面图.pdf');
  assert.equal((await app.inject(`/schemes/S-1/drawings/${assetId}/download`)).json().data.filename, '平面图.pdf');
  const preview = await app.inject(`/schemes/S-1/drawings/${assetId}/download?disposition=preview`);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().data.downloadUrl, 'http://localhost:19000/preview');
  assert.equal(preview.json().data.mimeType, 'application/pdf');
  assert.equal((await app.inject(`/schemes/S-1/drawings/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/download`)).statusCode, 404);
  const unpublished = setup({ published: false });
  const unpublishedApp = Fastify();
  t.after(() => unpublishedApp.close());
  await registerClientSchemeAssetRoutes(unpublishedApp, unpublished.pool, unpublished.storage);
  assert.equal((await unpublishedApp.inject('/schemes/S-1/drawings')).statusCode, 404);
  assert.equal((await unpublishedApp.inject(`/schemes/S-1/drawings/${assetId}/download`)).statusCode, 404);
  const missing = setup({ empty: true });
  const missingApp = Fastify();
  t.after(() => missingApp.close());
  await registerClientSchemeAssetRoutes(missingApp, missing.pool, missing.storage);
  assert.deepEqual((await missingApp.inject('/schemes/S-1/artworks')).json().data.items, []);
  assert.equal((await missingApp.inject(`/schemes/S-1/artworks/${assetId}/download`)).statusCode, 404);
  assert.equal((await app.inject('/schemes/S-1/model/download?disposition=preview')).statusCode, 415);
});
