import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyRequirement, type Catalog } from '../../src/modules/selection/domain.js';
import { parseRequirement } from '../../src/modules/selection/parse.js';

const catalog: Catalog = {
  boothSpaces: [],
  openingCounts: [
    { id: '1', label: '1面开口' },
    { id: '2', label: '2面开口' },
    { id: '3', label: '3面开口' },
    { id: '4', label: '4面开口（岛式）' },
  ],
  productSystems: [],
  styles: [
    { id: 'modern', label: '现代简约' },
    { id: 'tech', label: '科技感' },
  ],
  industries: [],
  budgetTiers: [],
  zones: [{ id: 'storage', label: '储藏间' }],
  features: [],
};

test('text overrides form dimensions and replaces the entire style selection while deriving area', () => {
  const form = { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, areaM2: 18, styleIds: ['modern'] };
  const result = parseRequirement('长9米，科技感', form, catalog);
  assert.equal(result.status, 'ready');
  assert.equal(result.requirement.lengthMm, 9000);
  assert.equal(result.requirement.widthMm, 3000);
  assert.equal(result.requirement.areaM2, 27);
  assert.deepEqual(result.requirement.styleIds, ['tech']);
  assert.equal(result.fieldSources.areaM2?.source, 'derived');
  assert.ok(result.overrides.some(override => override.field === 'lengthMm' && override.previousValue === 6000 && override.value === 9000));
  assert.ok(result.overrides.some(override => override.field === 'styleIds' && JSON.stringify(override.value) === '["tech"]'));
});

test('ambiguous dimension and unknown text block matching until clarified', () => {
  const ambiguous = parseRequirement('6×3', emptyRequirement(), catalog);
  assert.equal(ambiguous.status, 'needs_clarification');
  assert.ok(ambiguous.clarifications.some(item => item.field === 'lengthMm'));
  const unknown = parseRequirement('需要奇特舞台', emptyRequirement(), catalog);
  assert.equal(unknown.status, 'needs_clarification');
  assert.ok(unknown.clarifications.some(item => item.field === 'text'));
  assert.ok(unknown.unhandledText.length);
});

test('strong requirements are preserved separately from soft preferences', () => {
  const result = parseRequirement('必须有储藏间', emptyRequirement(), catalog);
  assert.deepEqual(result.requirement.requiredZoneIds, ['storage']);
  assert.deepEqual(result.requirement.zoneIds, []);
  assert.equal(result.status, 'ready');
});

test('opening count is parsed without adding an opening direction field', () => {
  const result = parseRequirement('两面开口', emptyRequirement(), catalog);
  assert.equal(result.status, 'ready');
  assert.equal(result.requirement.openingCount, 2);
  assert.equal(Object.keys(result.requirement).includes('openSides'), false);
});
