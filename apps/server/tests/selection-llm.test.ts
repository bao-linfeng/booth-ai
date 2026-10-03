import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyRequirement, type Catalog } from '../src/modules/selection/domain.js';
import { mergeExtraction, parseWithModels, requestExtraction } from '../src/modules/selection/llm.js';
import { matchSchemes } from '../src/modules/selection/match.js';
import type { ActiveAiModel } from '../src/infra/ai/types.js';
import { activeModel } from './ai-fixtures.js';

const catalog: Catalog = {
  dimensions: { lengthMm: [], widthMm: [], maxHeightMm: [], areaM2: [] }, boothSpaces: [],
  openingCounts: [{ id: '2', label: '两面开口' }], productSystems: [], industries: [], budgetTiers: [],
  styles: [{ id: 'modern', label: '现代简约' }], zones: [{ id: 'storage', label: '储藏间' }],
  features: [], applicabilityQuestions: [],
};
const models: ActiveAiModel[] = ['qwen', 'deepseek'].map((name, index) =>
  activeModel('openai', 'selection_parse', { name, model: name, position: index + 1, apiKey: 'test-key' }));

const fullCatalog: Catalog = {
  ...catalog,
  boothSpaces: [{ id: '6000-3000-4000', label: '6 × 3 × 4 m', lengthMm: 6000, widthMm: 3000, heightMm: 4000 }],
  productSystems: [{ id: 'system', label: '铝型材体系' }],
  industries: [{ id: 'medical', label: '医疗器械' }],
  budgetTiers: [{ id: 'budget', label: '材料购买预算 3万至5万元' }],
  zones: [...catalog.zones, { id: 'talk', label: '洽谈区' }],
  features: [{ id: 'screen', label: 'LED屏幕' }],
  applicabilityQuestions: [
    { id: 'hanging', label: '场馆是否允许吊挂？', helpText: '需由场馆确认' },
    { id: 'power', label: '是否有电源？', helpText: '展位供电情况' },
  ],
};

test('request sends the live sidebar dictionaries and structured extraction contract', async t => {
  const raw = { fields: {}, unhandledText: [] };
  const signal = new AbortController().signal;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      messages: { role: string; content: string }[]; response_format: { type: string }; max_tokens: number;
    };
    assert.equal(init.signal, signal);
    assert.equal(body.response_format.type, 'json_object');
    const system = body.messages.find(message => message.role === 'system')!.content;
    for (const field of Object.keys(emptyRequirement()).filter(field => field !== 'keywords')) assert.ok(system.includes(field), field);
    const input = JSON.parse(body.messages.find(message => message.role === 'user')!.content);
    assert.equal(input.text, '测试需求');
    for (const group of ['boothSpaces', 'openingCounts', 'productSystems', 'styles', 'industries', 'budgetTiers', 'zones', 'features', 'applicabilityQuestions'] as const) {
      assert.deepEqual(input.dictionaries[group], fullCatalog[group]);
    }
    assert.ok(body.max_tokens >= 2000);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }));
  });
  assert.deepEqual(await requestExtraction(models[0]!, '测试需求', fullCatalog, signal), raw);
});

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

test('negative evidence including the whole phrase cannot become a positive preference', () => {
  const result = mergeExtraction('不要储藏间', emptyRequirement(), fullCatalog, {
    fields: { zoneIds: { value: ['storage'], evidence: '不要储藏间' } }, unhandledText: [],
  });
  assert.equal(result.status, 'needs_clarification');
  assert.deepEqual(result.requirement.zoneIds, []);
  assert.deepEqual(result.requirement.excludedZoneIds, ['storage']);
});

test('negation in a previous clause does not block a separate positive preference', () => {
  const result = mergeExtraction('不要储藏间，洽谈区', emptyRequirement(), fullCatalog, {
    fields: { zoneIds: { value: ['talk'], evidence: '洽谈区' }, excludedZoneIds: { value: ['storage'], evidence: '不要储藏间' } }, unhandledText: [],
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.requirement.zoneIds, ['talk']);
  assert.deepEqual(result.requirement.excludedZoneIds, ['storage']);
});

test('natural language produces the same requirement and matching as sidebar values', () => {
  const text = '长六米，宽300厘米，限高四米，双面开口，采用铝型材体系，简洁现代，我们做医疗器械，材料购买预算 3万至5万元，希望有个地方和客户坐下聊，必须有LED屏幕，不要储藏间，场馆明确不允许吊挂';
  const result = mergeExtraction(text, emptyRequirement(), fullCatalog, {
    fields: {
      lengthMm: { value: 6000, evidence: '长六米' },
      widthMm: { value: 3000, evidence: '宽300厘米' },
      maxHeightMm: { value: 4000, evidence: '限高四米' },
      openingCount: { value: 2, evidence: '双面开口' },
      productSystemId: { value: 'system', evidence: '采用铝型材体系' },
      styleIds: { value: ['modern'], evidence: '简洁现代' },
      industryIds: { value: ['medical'], evidence: '我们做医疗器械' },
      budgetTierId: { value: 'budget', evidence: '材料购买预算 3万至5万元' },
      zoneIds: { value: ['talk'], evidence: '希望有个地方和客户坐下聊' },
      requiredFeatureIds: { value: ['screen'], evidence: '必须有LED屏幕' },
      excludedZoneIds: { value: ['storage'], evidence: '不要储藏间' },
      applicabilityAnswers: { value: { hanging: false }, evidence: '场馆明确不允许吊挂' },
    }, unhandledText: [],
  });
  const expected = {
    ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, maxHeightMm: 4000, areaM2: 18,
    openingCount: 2, productSystemId: 'system', styleIds: ['modern'], industryIds: ['medical'],
    budgetTierId: 'budget', zoneIds: ['talk'], requiredFeatureIds: ['screen'], excludedZoneIds: ['storage'],
    applicabilityAnswers: { hanging: false },
  };
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.requirement, expected);
  assert.deepEqual(result.unhandledText, []);
  assert.equal(result.fieldSources.areaM2?.source, 'derived');
  const candidate = {
    code: 'matching', specifications: { lengthMm: 6000, widthMm: 3000, heightMm: 4000, areaM2: 18, openingCount: 2, productSystemId: 'system', productSystemLabel: '铝型材体系' },
    images: [], styleId: 'modern', industryIds: ['medical'], budgetTierId: 'budget', zoneIds: ['talk'], featureIds: ['screen'],
    keywords: [], labelsConfirmed: true, applicabilityRules: [{ id: 'hanging', expectedValue: false }], applicabilityNotes: '',
  };
  const pool = [candidate, { ...candidate, code: 'excluded', zoneIds: ['talk', 'storage'] }];
  const match = matchSchemes(pool, result.requirement, 'filtered', true);
  assert.deepEqual(match, matchSchemes(pool, expected, 'filtered', false));
  assert.deepEqual(match.items.map(item => item.code), ['matching']);
});

test('model completes partial dictionary matches and ignores multi-select ordering', () => {
  for (const value of [['storage', 'talk'], ['talk', 'storage']]) {
    const result = mergeExtraction('需要储藏间和一个跟客户坐下聊的地方', emptyRequirement(), fullCatalog, {
      fields: { zoneIds: { value, evidence: '需要储藏间和一个跟客户坐下聊的地方' } }, unhandledText: [],
    });
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.requirement.zoneIds, value);
    assert.deepEqual(result.unhandledText, []);
  }
  const result = mergeExtraction('储藏间和洽谈区', emptyRequirement(), fullCatalog, {
    fields: { zoneIds: { value: ['talk', 'storage'], evidence: '储藏间和洽谈区' } }, unhandledText: [],
  });
  assert.equal(result.status, 'ready');
});

test('applicability answers accept false, preserve unanswered form values, and validate IDs and types', () => {
  const text = '场馆不允许吊挂';
  const form = { ...emptyRequirement(), applicabilityAnswers: { hanging: true, power: true } };
  const result = mergeExtraction(text, form, fullCatalog, {
    fields: { applicabilityAnswers: { value: { hanging: false }, evidence: text } }, unhandledText: [],
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.requirement.applicabilityAnswers, { hanging: false, power: true });
  assert.deepEqual(form.applicabilityAnswers, { hanging: true, power: true });
  assert.ok(result.overrides.some(item => item.field === 'applicabilityAnswers'));
  for (const value of [{ unknown: false }, { hanging: 'false' }, {}, []]) {
    assert.throws(() => mergeExtraction(text, form, fullCatalog, {
      fields: { applicabilityAnswers: { value, evidence: text } }, unhandledText: [],
    }));
  }
});

test('ambiguous dimensions do not discard reliable model fields or get silently assigned', () => {
  const result = mergeExtraction('6×3米，简洁现代', emptyRequirement(), fullCatalog, {
    fields: { lengthMm: { value: 6000, evidence: '6×3米' }, styleIds: { value: ['modern'], evidence: '简洁现代' } }, unhandledText: ['6×3米'],
  });
  assert.equal(result.parser, 'llm');
  assert.equal(result.status, 'needs_clarification');
  assert.equal(result.requirement.lengthMm, null);
  assert.deepEqual(result.requirement.styleIds, ['modern']);
  assert.ok(result.clarifications.some(item => item.field === 'lengthMm'));
});

test('unknown requirements survive recognized evidence and are deduplicated', () => {
  const result = mergeExtraction('简洁现代，需要旋转舞台', emptyRequirement(), fullCatalog, {
    fields: { styleIds: { value: ['modern'], evidence: '简洁现代' } }, unhandledText: ['需要旋转舞台'],
  });
  assert.equal(result.status, 'needs_clarification');
  assert.deepEqual(result.unhandledText, ['需要旋转舞台']);
});

test('conflicting scalar extraction and area do not silently override explicit dimensions', () => {
  const result = mergeExtraction('长6米，宽3米，面积20平方米', emptyRequirement(), fullCatalog, {
    fields: { lengthMm: { value: 9000, evidence: '长6米' } }, unhandledText: [],
  });
  assert.equal(result.status, 'needs_clarification');
  assert.equal(result.requirement.lengthMm, 6000);
  assert.equal(result.requirement.areaM2, 18);
  assert.ok(result.clarifications.some(item => item.field === 'lengthMm'));
  assert.ok(result.clarifications.some(item => item.field === 'areaM2'));
});

test('primary failure switches to backup and both failures degrade to rules', async () => {
  const calls: string[] = [];
  const result = await parseWithModels('简洁现代', emptyRequirement(), catalog, models, async model => {
    calls.push(model.name);
    if (model.name === 'qwen') throw new Error('timeout');
    return { fields: { styleIds: { value: ['modern'], evidence: '简洁现代' } }, unhandledText: [] };
  });
  assert.deepEqual(calls, ['qwen', 'qwen', 'deepseek']);
  assert.equal(result.parser, 'llm');
  const degraded = await parseWithModels('简洁现代', emptyRequirement(), catalog, models, async () => { throw new Error('invalid'); });
  assert.equal(degraded.parser, 'rules');
  assert.equal(degraded.degraded, true);
});
