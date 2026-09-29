import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyRequirement, type Catalog } from '../src/modules/client/selection/domain.js';
import { mergeExtraction, parseWithModels } from '../src/modules/client/selection/llm.js';
import type { ActiveAiModel } from '../src/infra/ai-models.js';

const catalog: Catalog = {
  dimensions: { lengthMm: [], widthMm: [], maxHeightMm: [], areaM2: [] }, boothSpaces: [],
  openingCounts: [{ id: '2', label: '两面开口' }], productSystems: [], industries: [], budgetTiers: [],
  styles: [{ id: 'modern', label: '现代简约' }], zones: [{ id: 'storage', label: '储藏间' }],
  features: [], applicabilityQuestions: [],
};
const models: ActiveAiModel[] = ['qwen', 'deepseek'].map((provider, index) => ({
  purpose: 'selection_parse', provider: provider as 'qwen' | 'deepseek', model: provider,
  apiKey: 'test-key', credentialConfigured: true, enabled: true, priority: index + 1, unitCredits: null, revision: 1,
}));

test('model extracts grounded synonym and leaves form constraints intact', () => {
  const form = { ...emptyRequirement(), widthMm: 3000 };
  const result = mergeExtraction('想要简洁现代的展台', form, catalog, {
    fields: { styleIds: { value: ['modern'], evidence: '简洁现代' } }, unhandledText: [],
  });
  assert.equal(result.parser, 'llm');
  assert.equal(result.degraded, false);
  assert.deepEqual(result.requirement.styleIds, ['modern']);
  assert.equal(result.fieldSources.styleIds?.evidence, '简洁现代');
  assert.equal(result.requirement.widthMm, 3000);
  assert.equal(result.status, 'ready');
});

test('invalid model enum or fabricated evidence never reaches matching', () => {
  for (const entry of [
    { value: ['fake'], evidence: '简洁现代' }, { value: ['modern'], evidence: '不存在的证据' },
  ]) {
    assert.throws(() => mergeExtraction('简洁现代', emptyRequirement(), catalog, { fields: { styleIds: entry }, unhandledText: [] }));
  }
});

test('model cannot silently reverse explicit negation; conflict requires confirmation', () => {
  const result = mergeExtraction('不要储藏间', emptyRequirement(), catalog, {
    fields: { zoneIds: { value: ['storage'], evidence: '储藏间' } }, unhandledText: [],
  });
  assert.equal(result.status, 'needs_clarification');
  assert.deepEqual(result.requirement.excludedZoneIds, ['storage']);
  assert.deepEqual(result.requirement.zoneIds, []);
});

test('primary failure switches to backup and both failures degrade to rules', async () => {
  const calls: string[] = [];
  const result = await parseWithModels('简洁现代', emptyRequirement(), catalog, models, async model => {
    calls.push(model.provider);
    if (model.provider === 'qwen') throw new Error('timeout');
    return { fields: { styleIds: { value: ['modern'], evidence: '简洁现代' } }, unhandledText: [] };
  });
  assert.deepEqual(calls, ['qwen', 'qwen', 'deepseek']);
  assert.equal(result.parser, 'llm');
  const degraded = await parseWithModels('简洁现代', emptyRequirement(), catalog, models, async () => { throw new Error('invalid'); });
  assert.equal(degraded.parser, 'rules');
  assert.equal(degraded.degraded, true);
});
