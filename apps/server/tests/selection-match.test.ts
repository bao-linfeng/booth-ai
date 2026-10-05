import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyRequirement, type Candidate } from '../src/modules/selection/domain.js';
import { matchSchemes } from '../src/modules/selection/match.js';

const candidate: Candidate = {
  code: 'BOOTH-1',
  specifications: {
    lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: 18,
    openingCount: 2, productSystemId: 'fs62', productSystemLabel: 'FS62',
  },
  images: [], styleId: null, industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
  labelsConfirmed: true, applicabilityRules: [], applicabilityNotes: '',
};

test('complete size selection excludes differing heights and rotated footprints independently of venue height', () => {
  const spaces = [{ id: 'size', label: '6 × 3 × 3.5 m', lengthMm: 6000, widthMm: 3000, heightMm: 3500 }];
  const higher = { ...candidate, code: 'HIGH', specifications: { ...candidate.specifications, heightMm: 4500 } };
  const rotated = { ...candidate, code: 'ROTATED', specifications: { ...candidate.specifications, lengthMm: 3000, widthMm: 6000 } };
  const requirement = { ...emptyRequirement(), boothSpaceId: 'size', lengthMm: 6000, widthMm: 3000, areaM2: 18, maxHeightMm: 5000, openingCount: 2 };
  const result = matchSchemes([candidate, higher, rotated], requirement, 'filtered', false, undefined, [], spaces);
  assert.deepEqual(result.items.map(item => item.code), ['BOOTH-1']);
  assert.equal(result.diagnostics.exclusions.dimensions, 2);
  assert.equal(result.diagnostics.exclusions.height, 0);
  assert.equal(matchSchemes([candidate], { ...requirement, maxHeightMm: 3000 }, 'filtered', false, undefined, [], spaces).status, 'no_match');
});

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

test('overlapping exclusions are counted independently and sorted by actual prevalence', () => {
  const requirement = { ...emptyRequirement(), productSystemId: 'fs62', maxHeightMm: 3000 };
  const candidates = [
    candidate,
    { ...candidate, code: 'BOOTH-2', specifications: { ...candidate.specifications, productSystemId: 'other' } },
    { ...candidate, code: 'BOOTH-3', specifications: { ...candidate.specifications, productSystemId: 'other', heightMm: 2500 } },
  ];
  const result = matchSchemes(candidates, requirement, 'filtered', false);
  assert.equal(result.status, 'no_match');
  assert.equal(result.diagnostics.exclusions.height, 2);
  assert.equal(result.diagnostics.exclusions.productSystem, 2);
  assert.equal(result.diagnostics.ready, 3);
  assert.match(result.reasons[1] ?? '', /产品体系不符：2 套/);
  assert.match(result.reasons[2] ?? '', /超过场馆限高：2 套/);
});

test('a combined empty result does not claim any single condition eliminated all schemes', () => {
  const requirement = { ...emptyRequirement(), productSystemId: 'fs62', maxHeightMm: 3000 };
  const candidates = [candidate, { ...candidate, code: 'BOOTH-2', specifications: { ...candidate.specifications, productSystemId: 'other', heightMm: 2500 } }];
  const result = matchSchemes(candidates, requirement, 'filtered', false);
  assert.deepEqual([result.diagnostics.exclusions.productSystem, result.diagnostics.exclusions.height], [1, 1]);
  assert.ok(result.reasons[0]?.includes('条件组合'));
  assert.ok(result.reasons.every(reason => !reason.includes('均超过')));
});

test('pre-pool exclusions are retained alongside filtered candidate failures', () => {
  const requirement = { ...emptyRequirement(), maxHeightMm: 3000 };
  const result = matchSchemes([candidate], requirement, 'filtered', false, {
    reviewedPublished: 5, ready: 1,
    exclusions: { unverifiedChecklist: 3, incompleteAssets: 2, invalidData: 0, productSystem: 0, height: 0, applicability: 0, tags: 0, dimensions: 0 }
  });
  assert.equal(result.diagnostics.exclusions.height, 1);
  assert.match(result.reasons[1] ?? '', /清单未核验：3 套/);
  assert.match(result.reasons[2] ?? '', /资产不完整：2 套/);
  assert.match(result.reasons[3] ?? '', /超过场馆限高：1 套/);
});

test('failed applicability and dimension checks remain visible even when another hard condition also fails', () => {
  const requirement = { ...emptyRequirement(), maxHeightMm: 3000, lengthMm: 9000, applicabilityAnswers: { indoor: true } };
  const conditional = { ...candidate, applicabilityRules: [{ id: 'indoor', expectedValue: false }] };
  const result = matchSchemes([conditional], requirement, 'filtered', false);
  assert.equal(result.status, 'no_match');
  assert.equal(result.diagnostics.exclusions.height, 1);
  assert.equal(result.diagnostics.exclusions.applicability, 1);
  assert.equal(result.diagnostics.exclusions.dimensions, 1);
  assert.ok(result.reasons.some(reason => reason.includes('适用条件不符：1 套')));
});
