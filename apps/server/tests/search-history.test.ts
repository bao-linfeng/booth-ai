import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import pg from 'pg';
import type { createStorage } from '../src/infra/storage.js';
import { registerClientProjectRoutes } from '../src/modules/client/projects/index.js';
import { listSearchJobs } from '../src/modules/client/projects/search-jobs.js';
import { assertThemeSearch, themeRequestHash, type ThemeParameters } from '../src/modules/client/theme-jobs/service.js';

const storage = { signDownload: async (key: string) => `https://assets.example/${key}` } as ReturnType<typeof createStorage>;

test('search history returns one inline theme and its artwork previews per search and scheme', async t => {
  const userId = randomUUID();
  const searchId = randomUUID();
  const themeJobId = randomUUID();
  const artworkJobId = randomUUID();
  const pool = { query: async (sql: string, params: unknown[]) => {
    assert.equal(params[0], userId);
    if (sql.includes('count(*)')) return { rows: [{ total: 1 }] };
    if (sql.includes('FROM selection_searches')) return { rows: [{
      id: searchId, status: 'matched', mode: 'filtered', inputText: '', finalRequirement: {},
      directCount: 2, referenceCount: 0, randomCount: 0, resultCount: 2,
      resultSnapshot: [{ code: 'SCHEME-A', matchType: 'direct', specifications: {} }, { code: 'SCHEME-B', matchType: 'direct', specifications: {} }],
      createdAt: '2026-10-01T02:00:00.000Z',
    }] };
    assert.deepEqual(params[1], [searchId]);
    return { rows: [{ searchId, schemeCode: 'SCHEME-A', jobId: themeJobId, status: 'succeeded',
      createdAt: '2026-10-01T03:00:00.000Z', objectKey: 'theme.png', artworkJobId, artworkStatus: 'succeeded',
      deliveryStatus: 'ready', artworkCreatedAt: '2026-10-01T04:00:00.000Z', views: [{ direction: 'front', objectKey: 'front.png' }] }] };
  } } as unknown as pg.Pool;
  const redis = { get: async () => JSON.stringify({ site: 'client', localId: userId, expiresAt: Math.floor(Date.now() / 1000) + 3600 }) } as unknown as Redis;
  const app = Fastify();
  t.after(() => app.close());
  await registerClientProjectRoutes(app, pool, redis, storage);
  const response = await app.inject({ url: '/me/searches', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  const items = response.json().data.items[0].items;
  assert.deepEqual(items[0].theme, { jobId: themeJobId, status: 'succeeded', createdAt: '2026-10-01T03:00:00.000Z', previewUrl: 'https://assets.example/theme.png' });
  assert.deepEqual(items[0].artwork.views, [{ direction: 'front', previewUrl: 'https://assets.example/front.png' }]);
  assert.equal(items[0].artwork.jobId, artworkJobId);
  assert.equal(items[1].theme, null);
  assert.equal(items[1].artwork, null);
  assert.ok(!response.body.includes('objectKey'));
});

test('search history rejects unauthenticated requests before reading generation records', async t => {
  const app = Fastify();
  t.after(() => app.close());
  const pool = { query: async () => { assert.fail('Unauthenticated request queried the database'); } } as unknown as pg.Pool;
  await registerClientProjectRoutes(app, pool, { get: async () => null } as unknown as Redis, storage);
  assert.equal((await app.inject({ url: '/me/searches' })).statusCode, 401);
});

test('empty search history does not query generation tables', async () => {
  const pool = { query: async () => { assert.fail('Empty search list queried the database'); } } as unknown as pg.Pool;
  assert.equal((await listSearchJobs(pool, storage, randomUUID(), [])).size, 0);
});

test('theme search association rejects wrong users and schemes and participates in request identity', async () => {
  const parameters: ThemeParameters = { schemeCode: 'S-1', sourceAssetId: 'source', input: { industryId: 'industry', styleId: 'style' },
    requestedCount: 1, cacheMode: 'reuse', searchId: randomUUID() };
  const userId = randomUUID();
  const pool = { query: async (_sql: string, params: unknown[]) => {
    assert.deepEqual(params, [parameters.searchId, userId, parameters.schemeCode]);
    return { rows: [] };
  } } as unknown as pg.Pool;
  await assert.rejects(assertThemeSearch(pool, userId, parameters), { statusCode: 409, reason: 'SEARCH_UNAVAILABLE' });
  assert.notEqual(themeRequestHash(parameters), themeRequestHash({ ...parameters, searchId: randomUUID() }));
});

test('search previews: migration backfill, distinct searches, latest theme, selected result and four-direction isolation',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL }, async t => {
    const schema = `search_history_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
    for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n) && !n.startsWith('044_')).sort()) {
      await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const user = randomUUID();
    const other = randomUUID();
    const scheme = randomUUID();
    const code = 'SEARCH-SCHEME';
    const attempt = randomUUID();
    const searches = [randomUUID(), randomUUID()];
    for (const [index, id] of [user, other].entries()) await pool.query('INSERT INTO users(id,external_user_id,username) VALUES($1::uuid,$2,$1::text)', [id, index + 1]);
    await pool.query("INSERT INTO schemes(id,code,name) VALUES($1,$2,$2)", [scheme, code]);
    await pool.query('INSERT INTO selection_attempts(id,visitor_id,user_id) VALUES($1,$2,$3)', [attempt, randomUUID(), user]);
    for (const [index, id] of searches.entries()) await pool.query(
      `INSERT INTO selection_searches(id,attempt_id,visitor_id,user_id,mode,status,final_requirement,result_snapshot,rules_version,dictionary_version,duration_ms,created_at)
       VALUES($1,$2,'test',$3,'filtered','matched','{}',$4,'test','test',0,$5)`,
      [id, attempt, user, JSON.stringify([{ code }]), `2026-10-01T0${index * 2 + 1}:00:00.000Z`],
    );
    async function asset(key: string) {
      const id = randomUUID();
      await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name) VALUES($1,$2,'rendering',$3)", [id, scheme, key]);
      const version = (await pool.query<{ id: string }>("INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,$2,'image/png',10,'test') RETURNING id", [id, key])).rows[0]!.id;
      return { id, version };
    }
    const source = await asset('source.png');
    async function theme(time: string, owner = user) {
      const id = randomUUID();
      await pool.query(`INSERT INTO theme_jobs(id,user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,status,created_at)
        VALUES($1::uuid,$2,$3,$4,'test',$1::text,'{}',1,'succeeded',$5)`, [id, owner, code, source.id, time]);
      return id;
    }
    const first = await theme('2026-10-01T02:00:00.000Z');
    const second = await theme('2026-10-01T04:00:00.000Z');
    const latest = await theme('2026-10-01T05:00:00.000Z');
    const foreign = await theme('2026-10-01T06:00:00.000Z', other);
    const unassociated = await theme('2026-10-01T00:00:00.000Z');
    const result = randomUUID();
    const selected = await asset('selected.png');
    await pool.query('INSERT INTO theme_job_results(id,job_id,ordinal,asset_id,asset_version_id) VALUES($1,$2,2,$3,$4)', [result, latest, selected.id, selected.version]);
    await pool.query('INSERT INTO theme_job_results(job_id,ordinal,asset_id,asset_version_id) VALUES($1,1,$2,$3)', [latest, source.id, source.version]);
    await pool.query('UPDATE theme_jobs SET selected_result_id=$1,selection_revision=1 WHERE id=$2', [result, latest]);
    const artwork = randomUUID();
    await pool.query(`INSERT INTO artwork_jobs(id,user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,theme_job_id,theme_result_id,theme_selection_revision,status,delivery_status)
      VALUES($1::uuid,$2,$3,$4,'test',$1::text,'{}',4,$5,$6,1,'succeeded','ready')`, [artwork, user, code, source.id, latest, result]);
    for (const [index, direction] of ['right', 'left', 'back', 'front'].entries()) {
      const image = await asset(`${direction}.png`);
      await pool.query('INSERT INTO artwork_job_results(job_id,ordinal,asset_id,asset_version_id,direction) VALUES($1,$2,$3,$4,$5)', [artwork, index, image.id, image.version, direction]);
    }
    await pool.query(await readFile(new URL('../migrations/044_theme_job_search.sql', import.meta.url), 'utf8'));
    const associations = (await pool.query<{ id: string; searchId: string | null }>('SELECT id,search_id AS "searchId" FROM theme_jobs')).rows;
    assert.equal(associations.find(job => job.id === first)?.searchId, searches[0]);
    for (const id of [second, latest]) assert.equal(associations.find(job => job.id === id)?.searchId, searches[1]);
    for (const id of [foreign, unassociated]) assert.equal(associations.find(job => job.id === id)?.searchId, null);
    const jobs = await listSearchJobs(pool, storage, user, searches);
    assert.equal(jobs.get(searches[0]!)?.get(code)?.theme.jobId, first);
    const generation = jobs.get(searches[1]!)?.get(code);
    assert.equal(generation?.theme.jobId, latest);
    assert.equal(generation?.theme.previewUrl, 'https://assets.example/selected.png');
    assert.equal(generation?.artwork?.jobId, artwork);
    assert.deepEqual(generation?.artwork?.views.map(view => view.direction), ['front', 'back', 'left', 'right']);
    assert.equal((await listSearchJobs(pool, storage, other, searches)).size, 0);
    await assertThemeSearch(pool, user, { schemeCode: code, searchId: searches[0], sourceAssetId: source.id, input: { industryId: 'test', styleId: 'test' }, requestedCount: 1, cacheMode: 'reuse' });
    await pool.query('UPDATE theme_jobs SET selection_revision=2 WHERE id=$1', [latest]);
    assert.equal((await listSearchJobs(pool, storage, user, searches)).get(searches[1]!)?.get(code)?.artwork, null);
  });
