import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import { emptyRequirement, type Catalog } from '../src/modules/selection/domain.js';
import { matchSchemes } from '../src/modules/selection/match.js';
import { loadCandidatePool, signMatchItems } from '../src/modules/selection/repository.js';

test('public pool diagnoses checklist and asset exclusions even when no candidates can be loaded', async () => {
  const rows = [
    { id: 'one', code: 'ONE', bomVerified: false },
    { id: 'two', code: 'TWO', bomVerified: true },
    { id: 'three', code: 'THREE', bomVerified: false },
  ].map(row => ({
    ...row, lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: 18, openingCount: 2,
    productSystemId: 'fs62', styleId: null, industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
  }));
  const pool = { query: async (sql: string) => ({ rows: sql.includes('FROM schemes s') ? rows : [] }) } as unknown as pg.Pool;
  const catalog = { productSystems: [{ id: 'fs62', label: 'FS62' }] } as unknown as Catalog;
  const { candidates, diagnostics } = await loadCandidatePool(pool, catalog);
  assert.deepEqual(candidates, []);
  assert.equal(diagnostics.reviewedPublished, 3);
  assert.equal(diagnostics.exclusions.unverifiedChecklist, 2);
  assert.equal(diagnostics.exclusions.incompleteAssets, 3);
  const result = matchSchemes(candidates, { ...emptyRequirement(), productSystemId: 'fs62' }, 'filtered', false, diagnostics);
  assert.equal(result.status, 'no_match');
  assert.match(result.reasons[1] ?? '', /资产不完整：3 套/);
  assert.match(result.reasons[2] ?? '', /清单未核验：2 套/);
});

test('candidate pool groups assets per scheme and only returned items get signed URLs', async () => {
  const schemes = ['A', 'B', 'C', 'D', 'E'].map(code => ({
    id: `id-${code}`, code, bomVerified: true, lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: 18, openingCount: 2,
    productSystemId: 'fs62', styleId: null, industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
  }));
  const assets = schemes.flatMap(({ id: schemeId }) => [
    ...['model', 'checklist', 'drawing', 'artwork'].map(type => ({ id: `${schemeId}-${type}`, schemeId, type, order: 0, relatedAssetId: null, objectKey: `${schemeId}/${type}`, width: null, height: null, mime: 'application/octet-stream' })),
    ...[0, 1, 2].flatMap(order => [
      { id: `${schemeId}-r${order}`, schemeId, type: 'rendering', order, relatedAssetId: null, objectKey: `${schemeId}/r${order}`, width: 1600, height: 900, mime: 'image/png' },
      { id: `${schemeId}-m${order}`, schemeId, type: 'mask', order, relatedAssetId: `${schemeId}-r${order}`, objectKey: `${schemeId}/m${order}`, width: 1600, height: 900, mime: 'image/png' },
    ]),
  ]);
  const pool = { query: async (sql: string) => ({ rows: sql.includes('FROM schemes s') ? schemes : assets }) } as unknown as pg.Pool;
  const catalog = { productSystems: [{ id: 'fs62', label: 'FS62' }] } as unknown as Catalog;
  const { candidates, diagnostics } = await loadCandidatePool(pool, catalog);
  assert.equal(diagnostics.ready, 5);
  assert.deepEqual(candidates[1]!.images.map(image => image.objectKey), ['id-B/r0', 'id-B/r1', 'id-B/r2']);

  const signed: string[] = [];
  const storage = { signDownload: async (key: string) => { signed.push(key); return `https://assets.example/${key}`; } };
  const { items } = matchSchemes(candidates, { ...emptyRequirement(), productSystemId: 'fs62' }, 'filtered', false, diagnostics);
  const publicItems = await signMatchItems(storage, items);
  assert.equal(publicItems.length, 3);
  assert.equal(signed.length, 9);
  assert.deepEqual(publicItems[0]!.images[0], { assetId: 'id-A-r0', order: 0, width: 1600, height: 900, url: 'https://assets.example/id-A/r0', thumbnailUrl: 'https://assets.example/id-A/r0' });
});
