import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { emptyRequirement } from '../src/modules/selection/domain.js';
import { getSchemeCoverUrl, getSelectionCatalog, getSelectionScheme, matchSelection, parseSelection } from '../src/modules/selection/service.js';

const identity = { visitorId: 'visitor_for_selection_test', userId: 'user-1' };

function selectionPool() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = { query: async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO selection_attempts')) return { rows: [{ id: params[0] }] };
    if (sql.includes('INSERT INTO selection_parses')) return { rows: [{ id: 'parse-1' }] };
    if (sql.includes('INSERT INTO selection_searches')) return { rows: [{ id: 'search-1' }] };
    if (sql.includes('FROM dictionaries d JOIN dictionary_items')) return { rows: [
      { type: 'opening_count', id: 'opening-2', value: '2', label: '双开口' },
      { type: 'product_system', id: 'system-1', value: 'system', label: '标准系统' },
    ] };
    return { rows: [] };
  } } as unknown as pg.Pool;
  return { pool, calls };
}

test('selection service parses without HTTP and records rule fallback with identity and dictionary version', async () => {
  const { pool, calls } = selectionPool();
  const result = await parseSelection(pool, { aiModelEncryptionKey: 'a'.repeat(64) }, {
    attemptId: 'attempt-1', text: '长6米，宽3米', form: emptyRequirement(),
  }, identity);
  assert.equal(result.requirement.lengthMm, 6000);
  assert.equal(result.requirement.widthMm, 3000);
  assert.equal(result.parser, 'rules');
  assert.equal(result.attemptId, 'attempt-1');
  assert.equal(result.parseId, 'parse-1');
  assert.equal(result.visitorId, identity.visitorId);
  const recorded = calls.find(call => call.sql.includes('INSERT INTO selection_parses'));
  assert.ok(recorded);
  assert.deepEqual(recorded.params.slice(0, 4), ['attempt-1', identity.visitorId, identity.userId, '长6米，宽3米']);
  assert.equal(recorded.params[14], result.dictionaryVersion);
  assert.equal(recorded.params.at(-1), 'null');
});

test('selection service records no-match diagnostics and links search to parse and identity', async () => {
  const { pool, calls } = selectionPool();
  const result = await matchSelection(pool, { signDownload: async () => 'signed' }, {
    attemptId: 'attempt-1', parseId: 'parse-1', mode: 'filtered',
    inputContext: { textProvided: true, text: '需要六米展台', degradedParse: true },
    requirement: { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, productSystemId: 'system-1' },
  }, identity);
  assert.equal(result.status, 'no_match');
  assert.equal(result.searchId, 'search-1');
  assert.equal(result.diagnostics.ready, 0);
  const recorded = calls.find(call => call.sql.includes('INSERT INTO selection_searches'));
  assert.ok(recorded);
  assert.deepEqual(recorded.params.slice(0, 7), ['attempt-1', 'parse-1', identity.visitorId, identity.userId, 'filtered', 'no_match', '需要六米展台']);
  assert.equal(recorded.params[17], true);
  assert.deepEqual(JSON.parse(String(recorded.params[19])), result.diagnostics);
});

test('selection dependency errors preserve HTTP status semantics and invisible schemes remain unavailable', async () => {
  const unavailable = { query: async () => { throw new Error('database unavailable'); } } as unknown as pg.Pool;
  await assert.rejects(getSelectionCatalog(unavailable), { statusCode: 503 });
  const expected = Object.assign(new Error('invalid input'), { statusCode: 422 });
  const rejected = { query: async () => { throw expected; } } as unknown as pg.Pool;
  await assert.rejects(getSelectionCatalog(rejected), error => error === expected);
  const { pool } = selectionPool();
  await assert.rejects(getSelectionScheme(pool, { signDownload: async () => 'signed' }, 'HIDDEN'), { statusCode: 404 });
});

test('scheme cover signs the first rendering by order and hides schemes outside the public pool', async () => {
  const scheme = { id: 'scheme-1', code: 'COVER', bomVerified: true, lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: 18, openingCount: 2,
    productSystemId: 'system-1', styleId: null, industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [] };
  const assets = [
    ...['model', 'checklist', 'drawing', 'artwork'].map(type => ({ id: type, schemeId: scheme.id, type, order: 0, relatedAssetId: null, objectKey: type, width: null, height: null, mime: 'application/octet-stream' })),
    ...[2, 0, 1].flatMap(order => [
      { id: `r${order}`, schemeId: scheme.id, type: 'rendering', order, relatedAssetId: null, objectKey: `scheme/r${order}`, width: 1600, height: 900, mime: 'image/png' },
      { id: `m${order}`, schemeId: scheme.id, type: 'mask', order, relatedAssetId: `r${order}`, objectKey: `scheme/m${order}`, width: 1600, height: 900, mime: 'image/png' },
    ]),
  ];
  const { pool: base } = selectionPool();
  const pool = { query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM schemes s')) return { rows: params[0] === 'COVER' ? [scheme] : [] };
    if (sql.includes('JOIN LATERAL')) return { rows: assets };
    return base.query(sql, params);
  } } as unknown as pg.Pool;
  const signed: Array<[string, number]> = [];
  const storage = { signDownload: async (key: string, expiresIn = 300) => { signed.push([key, expiresIn]); return `https://assets.example/${key}`; } };
  assert.equal(await getSchemeCoverUrl(pool, storage, 'COVER', 300), 'https://assets.example/scheme/r0');
  assert.deepEqual(signed, [['scheme/r0', 300]]);
  await assert.rejects(getSchemeCoverUrl(pool, storage, 'HIDDEN', 300), { statusCode: 404 });
});
