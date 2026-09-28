import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyRequirement, type Candidate } from '../src/modules/client/selection/domain.js';
import { matchSchemes } from '../src/modules/client/selection/match.js';

const candidate: Candidate = {
  code: 'BOOTH-1',
  specifications: {
    lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: 18,
    openingCount: 2, productSystemId: 'fs62', productSystemLabel: 'FS62',
  },
  images: [], styleId: null, industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
  labelsConfirmed: true, applicabilityRules: [], applicabilityNotes: '',
};

test('equal area does not hide an excessive deviation in either dimension', () => {
  const requirement = { ...emptyRequirement(), lengthMm: 9000, widthMm: 2000, areaM2: 18 };
  const result = matchSchemes([candidate], requirement, 'filtered', false);
  assert.equal(result.status, 'no_match');
  assert.equal(result.counts.total, 0);
});

test('within-threshold dimension changes remain references with explicit differences', () => {
  const requirement = { ...emptyRequirement(), lengthMm: 7500, widthMm: 3000, areaM2: 22.5 };
  const result = matchSchemes([candidate], requirement, 'filtered', false);
  assert.equal(result.items[0]?.matchType, 'reference');
  assert.ok(result.items[0]?.differences.some(difference => difference.field === 'lengthMm'));
});

test('incomplete structural information never produces a direct match', () => {
  const requirement = { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, areaM2: 18 };
  const result = matchSchemes([candidate], requirement, 'filtered', false);
  assert.equal(result.items[0]?.matchType, 'reference');
  assert.ok(result.items[0]?.pendingConfirmations.length);
});

test('matching opening counts and complete structural requirements produce a direct match', () => {
  const requirement = { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, areaM2: 18, maxHeightMm: 4000, openingCount: 2 };
  const result = matchSchemes([candidate], requirement, 'filtered', false);
  assert.equal(result.items[0]?.matchType, 'direct');
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(result.items[0]?.differences, []);
});

test('different opening counts remain a reference with a count difference', () => {
  const requirement = { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, areaM2: 18, maxHeightMm: 4000, openingCount: 3 };
  const result = matchSchemes([candidate], requirement, 'filtered', false);
  assert.equal(result.items[0]?.matchType, 'reference');
  assert.ok(result.items[0]?.differences.some(difference => difference.field === 'openingCount'));
});

test('hard tag requirements never rely on unconfirmed labels', () => {
  const requirement = { ...emptyRequirement(), requiredZoneIds: ['storage'] };
  const unconfirmed = { ...candidate, labelsConfirmed: false, zoneIds: ['storage'] };
  const result = matchSchemes([unconfirmed], requirement, 'filtered', false);
  assert.equal(result.counts.total, 0);
});
