import assert from 'node:assert/strict';
import test from 'node:test';
import { localizedLabel, resolveDictionaryTerms } from '../src/modules/dictionaries/language.js';
import { emptyRequirement, validateRequirement, type Catalog } from '../src/modules/selection/domain.js';
import { parseRequirement } from '../src/modules/selection/parse.js';
import { mergeExtraction } from '../src/modules/selection/llm.js';

const modern = { id: 'modern', label: '现代简约', value: 'modern', labels: { en: 'Modern minimalist', ja: 'モダン・ミニマル' },
  aliases: [{ locale: 'en', text: 'modern minimalism' }, { locale: 'ja', text: 'ミニマル' }] };
const catalog: Catalog = { boothSpaces: [
  { id: 'size', label: '6 × 3 × 4.5 m', lengthMm: 6000, widthMm: 3000, heightMm: 4500 },
], openingCounts: [], productSystems: [], styles: [modern], industries: [], budgetTiers: [],
zones: [{ id: 'meeting', label: '洽谈区', labels: { en: 'Meeting area', ja: '商談スペース' } },
  { id: 'storage', label: '储藏间', labels: { en: 'Storage room', ja: '収納室' } }], features: [] };

test('default, translations, codes and normalized aliases resolve to one identity', () => {
  for (const term of ['现代简约', 'Modern minimalist', 'モダン・ミニマル', 'ＭＯＤＥＲＮ', '  modern minimalism  ', 'ミニマル']) {
    assert.deepEqual(resolveDictionaryTerms([modern], [term]), ['modern']);
  }
  assert.equal(localizedLabel(modern, 'en-US'), 'Modern minimalist');
  assert.equal(localizedLabel(modern, 'ja-JP'), 'モダン・ミニマル');
  assert.equal(localizedLabel(modern, 'fr'), '现代简约');
  assert.throws(() => resolveDictionaryTerms([modern], ['unknown']), { statusCode: 400 });
  assert.throws(() => resolveDictionaryTerms([modern, { ...modern, id: 'other' }], ['现代简约']), { statusCode: 400 });
});

test('rules use multilingual names with Latin word boundaries and longest terms', () => {
  for (const text of ['现代简约', 'MODERN MINIMALIST', 'モダン・ミニマル', 'ＭＯＤＥＲＮ ＭＩＮＩＭＡＬＩＳＴ', 'Modern   minimalist']) {
    const result = parseRequirement(text, emptyRequirement(), catalog);
    assert.deepEqual(result.requirement.styleIds, ['modern']);
    assert.equal(result.status, 'ready');
  }
  assert.deepEqual(parseRequirement('postmodern', emptyRequirement(), catalog).requirement.styleIds, []);
  const budgetCatalog = { ...catalog, budgetTiers: [{ id: 'budget', value: 'low', label: '低(3万以内)' }] };
  assert.equal(parseRequirement('low ceiling', emptyRequirement(), budgetCatalog).requirement.budgetTierId, null);
  const result = parseRequirement('no storage room, must have meeting area', emptyRequirement(), catalog);
  assert.deepEqual(result.requirement.excludedZoneIds, ['storage']);
  assert.deepEqual(result.requirement.requiredZoneIds, ['meeting']);
  assert.deepEqual(parseRequirement('収納室は不要', emptyRequirement(), catalog).requirement.excludedZoneIds, ['storage']);
  const ambiguous = parseRequirement('现代简约', emptyRequirement(), { ...catalog, styles: [modern, { ...modern, id: 'other' }] });
  assert.equal(ambiguous.status, 'needs_clarification');
  assert.deepEqual(ambiguous.requirement.styleIds, []);
});

test('selected sizes derive footprint without substituting venue height and stale choices clear on text edits', () => {
  const form = validateRequirement({ ...emptyRequirement(), boothSpaceId: 'size' }, catalog);
  assert.equal(form.lengthMm, 6000);
  assert.equal(form.areaM2, 18);
  assert.equal(form.maxHeightMm, null);
  assert.throws(() => validateRequirement({ ...form, widthMm: 6000 }, catalog), { statusCode: 400 });
  assert.equal(parseRequirement('长9米', form, catalog).requirement.boothSpaceId, null);
  for (const text of ['长6米，宽3米，高4.5米', 'length 6m, width 3m, height 4.5m', '間口6m、奥行き3m、高さ4.5m']) {
    const result = parseRequirement(text, emptyRequirement(), catalog);
    assert.equal(result.requirement.boothSpaceId, 'size');
    assert.equal(result.requirement.maxHeightMm, null);
  }
});

test('model extraction accepts only live size identities and retains original Japanese evidence', () => {
  const text = 'モダン・ミニマル';
  const result = mergeExtraction(text, emptyRequirement(), catalog, {
    fields: { styleIds: { value: ['modern'], evidence: text } }, unhandledText: [],
  });
  assert.deepEqual(result.requirement.styleIds, ['modern']);
  assert.equal(result.fieldSources.styleIds?.evidence, text);
  const size = mergeExtraction('長さ6m、奥行き3m、高さ4.5m', emptyRequirement(), catalog, {
    fields: { boothSpaceId: { value: 'size', evidence: '長さ6m、奥行き3m、高さ4.5m' } }, unhandledText: [],
  });
  assert.equal(size.requirement.boothSpaceId, 'size');
  assert.equal(size.requirement.maxHeightMm, null);
  assert.throws(() => mergeExtraction('サイズ', emptyRequirement(), catalog, {
    fields: { boothSpaceId: { value: 'invented', evidence: 'サイズ' } }, unhandledText: [],
  }));
});
