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

test('dimension pairs labelled length-then-width are assigned in order', () => {
  for (const [text, lengthMm, widthMm] of [
    ['长宽 6*3', 6000, 3000],
    ['长×宽：6×3米', 6000, 3000],
    ['展位长宽为9x4.5m', 9000, 4500],
    ['长宽 6000*3000', 6000, 3000],
    ['长宽 600*300厘米', 6000, 3000],
    ['length x width 6x3m', 6000, 3000],
  ] as const) {
    const result = parseRequirement(text, emptyRequirement(), catalog);
    assert.equal(result.status, 'ready', text);
    assert.deepEqual(
      [result.requirement.lengthMm, result.requirement.widthMm, result.requirement.areaM2],
      [lengthMm, widthMm, (lengthMm * widthMm) / 1e6],
      text,
    );
    assert.deepEqual(result.unhandledText, [], text);
    assert.equal(result.fieldSources.lengthMm?.evidence, text.trim());
  }
  // “宽 6米”不能被单项尺寸规则误认成宽度
  assert.equal(parseRequirement('长宽 6米*3米', emptyRequirement(), catalog).requirement.widthMm, 3000);
});

test('dimension pairs that cannot be read reliably still ask for confirmation', () => {
  const unitless = parseRequirement('长宽 600*300', emptyRequirement(), catalog);
  assert.equal(unitless.requirement.lengthMm, null);
  assert.ok(unitless.clarifications.some(item => item.field === 'lengthMm'));
  const conflict = parseRequirement('长宽 6*3，长9米', emptyRequirement(), catalog);
  assert.equal(conflict.status, 'needs_clarification');
  assert.ok(conflict.clarifications.some(item => item.field === 'lengthMm'));
  // 只写“长宽”却给出三个数，第三个数含义不明
  const extra = parseRequirement('长宽 6*3*4', emptyRequirement(), catalog);
  assert.ok(extra.clarifications.some(item => item.field === 'lengthMm'));
});

test('length-width-height triples select the matching booth space', () => {
  const spaces = { ...catalog, boothSpaces: [{ id: 'space-634', label: '6 × 3 × 4 m', lengthMm: 6000, widthMm: 3000, heightMm: 4000 }] };
  const matched = parseRequirement('长宽高 6*3*4', emptyRequirement(), spaces);
  assert.equal(matched.status, 'ready');
  assert.equal(matched.requirement.boothSpaceId, 'space-634');
  assert.equal(matched.requirement.maxHeightMm, null);
  const missing = parseRequirement('长宽高 6*3*5', emptyRequirement(), spaces);
  assert.equal(missing.requirement.boothSpaceId, null);
  assert.equal(missing.requirement.lengthMm, 6000);
  assert.ok(missing.clarifications.some(item => item.field === 'boothSpaceId'));
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
