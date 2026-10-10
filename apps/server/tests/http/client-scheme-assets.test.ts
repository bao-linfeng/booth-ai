import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type pg from 'pg';
import Fastify from 'fastify';
import type { createStorage } from '../../src/infra/storage.js';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { registerClientSchemeAssetRoutes } from '../../src/http/client/schemes/index.js';

const assetId = '123e4567-e89b-42d3-a456-426614174000';
const originalContent = Buffer.from('%PDF-1.7\n报馆图原件');
function setup(options: { published?: boolean; empty?: boolean } = {}) {
  const queries: string[] = [];
  const pool = { query: async (sql: string, params?: unknown[]) => {
    queries.push(sql);
    if (sql.includes('SELECT 1 FROM schemes')) return { rows: options.published === false ? [] : [{ '?column?': 1 }] };
    if (sql.includes('FROM schemes s')) return { rows: options.empty ? [] : [{ assetId, name: '平面图', sortOrder: 1,
      originalFilename: '平面图.pdf', mimeType: 'application/pdf', byteSize: originalContent.length,
      objectKey: 'private/key', versionId: 'version-1', assetRevision: 1,
      checksum: createHash('sha256').update(originalContent).digest('hex') }] };
    throw new Error(`Unexpected SQL ${sql}`);
  } } as unknown as pg.Pool;
  const storage = { getBuffer: async () => originalContent, signDownload: async (key: string) => {
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

function archiveSetup() {
  const content = Buffer.from([0, 255, 17, 128, 1]);
  const makeRow = (id: string, filename: string) => ({
    assetId: id, name: filename, originalFilename: filename, mimeType: 'image/png',
    byteSize: content.length, sortOrder: 1, assetRevision: 1, versionId: `version-${id}`,
    checksum: createHash('sha256').update(content).digest('hex'), objectKey: `private/${id}`,
  });
  const state = {
    published: true,
    drawings: [makeRow('drawing-1', '正立面 图.png'), makeRow('drawing-2', '平面图.pdf')],
    artworks: [makeRow('artwork-1', '画面 A.png')],
  };
  const reads: string[] = [];
  const queries: string[] = [];
  const pool = { query: async (sql: string, params: unknown[]) => {
    queries.push(sql);
    if (sql.includes('SELECT 1 FROM schemes')) return { rows: state.published ? [{ exists: true }] : [] };
    if (sql.includes('FROM schemes s')) return { rows: structuredClone(state.published ? params[1] === 'drawing' ? state.drawings : state.artworks : []) };
    throw new Error(`Unexpected SQL ${sql}`);
  } } as unknown as pg.Pool;
  const storage = { getBuffer: async (key: string, maxBytes: number) => {
    reads.push(key);
    assert.equal(maxBytes, content.length);
    return content;
  } } as unknown as ReturnType<typeof createStorage>;
  return { state, reads, queries, pool, storage, content, makeRow };
}

async function archiveApp(t: TestContext, deps: ReturnType<typeof archiveSetup>) {
  const app = await buildApp(loadConfig({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
    S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
    S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only',
    EXTERNAL_API_URL: 'https://api.example.test',
    SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
  }), { database: async () => {}, redis: async () => {}, storage: async () => {} });
  t.after(() => app.close());
  await registerClientSchemeAssetRoutes(app, deps.pool, deps.storage);
  return app;
}

test('both archive routes return complete ZIPs with original Unicode names, binary contents and isolated types', async t => {
  const deps = archiveSetup();
  const app = await archiveApp(t, deps);
  for (const type of ['drawings', 'artworks'] as const) {
    const code = 'TW66_BK_044_F&B';
    const base = `/schemes/${encodeURIComponent(code)}/${type}`;
    const list = await app.inject(base);
    const revision = list.json().data.revision;
    assert.match(revision, /^[a-f0-9]{64}$/);
    assert.ok(!list.body.includes('private/'));
    assert.ok(!list.body.includes('checksum'));
    const response = await app.inject(`${base}/download?revision=${revision}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/zip');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(String(response.headers['content-disposition']).includes(encodeURIComponent(`${code}@${type === 'drawings' ? '报馆图素材' : '平面素材'}.zip`)));
    const zip = await JSZip.loadAsync(response.rawPayload, { checkCRC32: true });
    assert.deepEqual(Object.keys(zip.files), deps.state[type].map(row => row.originalFilename));
    for (const row of deps.state[type]) assert.deepEqual(await zip.file(row.originalFilename)!.async('nodebuffer'), deps.content);
  }
  assert.ok(deps.queries.some(sql => sql.includes('a.type = $2') && sql.includes('JOIN scheme_baseline_assets a')));
});

test('archive revisions reject stale lists and are stable across repeated downloads', async t => {
  const deps = archiveSetup();
  const app = await archiveApp(t, deps);
  const base = '/schemes/S-1/drawings';
  const revision = (await app.inject(base)).json().data.revision;
  assert.equal((await app.inject(`${base}/download?revision=${revision}`)).statusCode, 200);
  assert.equal((await app.inject(`${base}/download?revision=${revision}`)).statusCode, 200);
  deps.reads.length = 0;
  deps.state.drawings[0]!.assetRevision++;
  const stale = await app.inject(`${base}/download?revision=${revision}`);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.reason, 'DELIVERABLE_REVISION_CHANGED');
  assert.deepEqual(deps.reads, []);
  for (const suffix of ['', '?revision=1', `?revision=${revision}&extra=1`]) {
    assert.equal((await app.inject(`${base}/download${suffix}`)).statusCode, 400);
  }
});

test('empty and unpublished sets never return a successful ZIP', async t => {
  const deps = archiveSetup();
  const app = await archiveApp(t, deps);
  deps.state.drawings = [];
  const revision = (await app.inject('/schemes/S-1/drawings')).json().data.revision;
  assert.equal((await app.inject(`/schemes/S-1/drawings/download?revision=${revision}`)).statusCode, 404);
  deps.state.published = false;
  assert.equal((await app.inject(`/schemes/S-1/drawings/download?revision=${revision}`)).statusCode, 404);
  assert.deepEqual(deps.reads, []);
});

test('archives reject incomplete metadata, duplicate or unsafe filenames and configured limits before reading storage', async t => {
  const scenarios = [
    { name: 'missing version', change: (d: ReturnType<typeof archiveSetup>) => { d.state.drawings[1]!.versionId = ''; }, status: 409 },
    { name: 'empty version', change: (d: ReturnType<typeof archiveSetup>) => { d.state.drawings[1]!.byteSize = 0; }, status: 409 },
    { name: 'missing checksum', change: (d: ReturnType<typeof archiveSetup>) => { d.state.drawings[1]!.checksum = 'invalid'; }, status: 409 },
    { name: 'case-insensitive collision', change: (d: ReturnType<typeof archiveSetup>) => { d.state.drawings[0]!.originalFilename = 'A.png'; d.state.drawings[1]!.originalFilename = 'a.PNG'; }, status: 409 },
    { name: 'normalized collision', change: (d: ReturnType<typeof archiveSetup>) => { d.state.drawings[0]!.originalFilename = 'é.png'; d.state.drawings[1]!.originalFilename = 'e\u0301.png'; }, status: 409 },
    { name: 'path traversal', change: (d: ReturnType<typeof archiveSetup>) => { d.state.drawings[0]!.originalFilename = '../图.png'; }, status: 409 },
    { name: 'reserved filename', change: (d: ReturnType<typeof archiveSetup>) => { d.state.drawings[0]!.originalFilename = 'CON.png'; }, status: 409 },
    { name: 'too many files', change: (d: ReturnType<typeof archiveSetup>) => { d.state.drawings = Array.from({ length: 31 }, (_, i) => d.makeRow(String(i), `${i}.png`)); }, status: 413 },
    { name: 'too many bytes', change: (d: ReturnType<typeof archiveSetup>) => { d.state.drawings[0]!.byteSize = 50 * 1024 * 1024; }, status: 413 },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async child => {
    const deps = archiveSetup();
    scenario.change(deps);
    const app = await archiveApp(child, deps);
    const revision = (await app.inject('/schemes/S-1/drawings')).json().data.revision;
    const response = await app.inject(`/schemes/S-1/drawings/download?revision=${revision}`);
    assert.equal(response.statusCode, scenario.status);
    assert.ok(response.json().error.reason);
    assert.ok(!String(response.headers['content-type']).includes('zip'));
    assert.deepEqual(deps.reads, []);
  });
});

test('one missing, unreadable, truncated or corrupt object fails the entire archive', async t => {
  for (const mode of ['missing', 'truncated', 'corrupt'] as const) await t.test(mode, async child => {
    const deps = archiveSetup();
    const originalRead = deps.storage.getBuffer;
    deps.storage.getBuffer = async (key, maxBytes) => {
      if (key === 'private/drawing-2') {
        if (mode === 'missing') throw new Error('secret upstream failure');
        return mode === 'truncated' ? Buffer.from([1]) : Buffer.alloc(deps.content.length);
      }
      return originalRead(key, maxBytes);
    };
    const app = await archiveApp(child, deps);
    const revision = (await app.inject('/schemes/S-1/drawings')).json().data.revision;
    const response = await app.inject(`/schemes/S-1/drawings/download?revision=${revision}`);
    assert.equal(response.statusCode, 503);
    assert.ok(!String(response.headers['content-type']).includes('zip'));
    assert.ok(!response.body.includes('secret'));
    assert.ok(!response.body.includes('private/'));
  });
});

test('changed membership, versions, ordering or publication during packaging discards the archive', async t => {
  for (const mode of ['membership', 'version', 'order', 'publication'] as const) await t.test(mode, async child => {
    const deps = archiveSetup();
    deps.storage.getBuffer = async () => {
      if (mode === 'membership') deps.state.drawings = deps.state.drawings.slice(0, 1);
      if (mode === 'version') deps.state.drawings[0]!.versionId = 'new-version';
      if (mode === 'order') deps.state.drawings[0]!.sortOrder++;
      if (mode === 'publication') deps.state.published = false;
      return deps.content;
    };
    const app = await archiveApp(child, deps);
    const revision = (await app.inject('/schemes/S-1/drawings')).json().data.revision;
    const response = await app.inject(`/schemes/S-1/drawings/download?revision=${revision}`);
    assert.equal(response.statusCode, mode === 'publication' ? 404 : 409);
    assert.ok(!String(response.headers['content-type']).includes('zip'));
  });
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
