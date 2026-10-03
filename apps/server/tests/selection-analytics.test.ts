import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyRequirement } from '../src/modules/selection/domain.js';
import { extractDemandTerms } from '../src/modules/selection-analytics/recording.js';

test('demand terms combine explicit keywords and Chinese or latin input terms without duplicates', () => {
  const requirement = { ...emptyRequirement(), keywords: ['储藏间', 'storage'] };
  const terms = extractDemandTerms('需要储藏间和智能接待台，storage 展示', requirement);
  assert.deepEqual(terms.slice(0, 4), ['储藏间', 'storage', '需要储藏间和智能接待台', '展示']);
  assert.equal(new Set(terms).size, terms.length);
});

test('demand term extraction ignores one-character fragments', () => {
  const terms = extractDemandTerms('我 想 要 A 展台', emptyRequirement());
  assert.ok(!terms.includes('我'));
  assert.ok(!terms.includes('A'));
  assert.ok(terms.includes('展台'));
});
