import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Catalog } from '../src/modules/selection/domain.js';
import { emptyRequirement } from '../src/modules/selection/domain.js';
import { extractDemandTerms } from '../src/modules/selection/analytics/recording.js';

const emptyCatalog: Catalog = {
  boothSpaces: [],
  openingCounts: [],
  productSystems: [],
  styles: [],
  industries: [],
  budgetTiers: [],
  zones: [],
  features: [],
};

test('demand terms combine explicit keywords and Chinese or latin input terms without duplicates', () => {
  const requirement = { ...emptyRequirement(), keywords: ['储藏间', 'storage'] };
  const terms = extractDemandTerms('需要储藏间和智能接待台，storage 展示', requirement, emptyCatalog);
  assert.deepEqual(terms.slice(0, 4), ['储藏间', 'storage', '需要储藏间和智能接待台', '展示']);
  assert.equal(new Set(terms).size, terms.length);
});

test('demand term extraction ignores one-character fragments', () => {
  const terms = extractDemandTerms('我 想 要 A 展台', emptyRequirement(), emptyCatalog);
  assert.ok(!terms.includes('我'));
  assert.ok(!terms.includes('A'));
  assert.ok(terms.includes('展台'));
});

test('demand terms include catalog labels for structured fields', () => {
  const catalog: Catalog = {
    ...emptyCatalog,
    styles: [{ id: 'modern', label: '现代简约' }],
    industries: [{ id: 'apparel', label: '服装纺织' }],
  };
  const requirement = { ...emptyRequirement(), styleIds: ['modern'], industryIds: ['apparel'] };
  const terms = extractDemandTerms('', requirement, catalog);
  assert.ok(terms.includes('现代简约'));
  assert.ok(terms.includes('服装纺织'));
});
