import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import { emptyRequirement, type Catalog } from '../src/modules/client/selection/domain.js';
import { matchSchemes } from '../src/modules/client/selection/match.js';
import { loadCandidatePool } from '../src/modules/client/selection/repository.js';

test('public pool diagnoses checklist and asset exclusions even when no candidates can be loaded', async () => {
  const rows = [
    { id: 'one', code: 'ONE', bomVerified: false },
    { id: 'two', code: 'TWO', bomVerified: true },
    { id: 'three', code: 'THREE', bomVerified: false },
  ].map(row => ({
    ...row, lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: 18, openingCount: 2,
    productSystemId: 'fs62', styleId: null, industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
    conditions: { status: 'confirmed', labelsConfirmed: true, rules: [] }
  }));
  const pool = { query: async (sql: string) => ({ rows: sql.includes('FROM schemes s') ? rows : [] }) } as unknown as pg.Pool;
  const catalog = { productSystems: [{ id: 'fs62', label: 'FS62' }], applicabilityQuestions: [] } as unknown as Catalog;
  const storage = { signDownload: async () => 'signed-url' };
  const { candidates, diagnostics } = await loadCandidatePool(pool, catalog, storage);
  assert.deepEqual(candidates, []);
  assert.equal(diagnostics.reviewedPublished, 3);
  assert.equal(diagnostics.exclusions.unverifiedChecklist, 2);
  assert.equal(diagnostics.exclusions.incompleteAssets, 3);
  const result = matchSchemes(candidates, { ...emptyRequirement(), productSystemId: 'fs62' }, 'filtered', false, diagnostics);
  assert.equal(result.status, 'no_match');
  assert.match(result.reasons[1] ?? '', /资产不完整：3 套/);
  assert.match(result.reasons[2] ?? '', /清单未核验：2 套/);
});
