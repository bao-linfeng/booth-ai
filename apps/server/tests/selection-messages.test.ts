import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyRequirement, type Candidate } from '../src/modules/selection/domain.js';
import { matchSchemes } from '../src/modules/selection/match.js';
import { message, resolveMessageLocale, type MessageLocale } from '../src/modules/selection/messages/index.js';
import { zh } from '../src/modules/selection/messages/zh.js';
import { parseRequirement } from '../src/modules/selection/parse.js';

const candidate: Candidate = {
  code: 'BOOTH-1',
  specifications: {
    lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: 18,
    openingCount: 2, productSystemId: 'fs62', productSystemLabel: 'FS62',
  },
  images: [], styleId: null, industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
  description: '',
};
const catalog = {
  boothSpaces: [], openingCounts: [], productSystems: [], styles: [], industries: [], budgetTiers: [], zones: [], features: [],
} as unknown as Parameters<typeof parseRequirement>[2];

test('message locale resolves from Accept-Language tags and falls back to Chinese', () => {
  assert.equal(resolveMessageLocale('en-US'), 'en');
  assert.equal(resolveMessageLocale('zh-CN'), 'zh');
  assert.equal(resolveMessageLocale('AR'), 'ar');
  assert.equal(resolveMessageLocale('ko-KR'), 'zh');
  assert.equal(resolveMessageLocale('constructor'), 'zh');
  assert.equal(resolveMessageLocale(undefined), 'zh');
});

test('every locale carries the same placeholders as the Chinese source', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join();
  const locales: MessageLocale[] = ['en', 'fr', 'de', 'ja', 'ru', 'it', 'es', 'ar', 'hi', 'pt', 'ms'];
  for (const locale of locales) {
    for (const [key, source] of Object.entries(zh)) {
      const probe = message(locale, key as keyof typeof zh, { field: '{field}', label: '{label}', id: '{id}', count: '{count}', text: '{text}' });
      assert.equal(placeholders(probe), placeholders(message('zh', key as keyof typeof zh, { field: '{field}', label: '{label}', id: '{id}', count: '{count}', text: '{text}' })),
        `${locale}.${key} placeholders differ from zh (${source})`);
    }
  }
});

test('random match pending note follows the requested locale', () => {
  const random = (locale?: MessageLocale) => matchSchemes([candidate], emptyRequirement(), 'random', false, undefined, [], locale).items[0]!;
  assert.equal(random().pendingConfirmations[0]!.message, zh.matchRandomPending);
  assert.match(random('en').pendingConfirmations[0]!.message, /^Random recommendation/);
});

test('differences, missing fields and no-match reasons are localized', () => {
  const requirement = { ...emptyRequirement(), lengthMm: 7000, openingCount: 3 };
  const result = matchSchemes([candidate], requirement, 'filtered', false, undefined, [], 'en');
  const item = result.items[0]!;
  assert.equal(item.differences[0]!.requested, 'Length 7 m');
  assert.equal(item.differences.at(-1)!.requested, '3 open sides');
  assert.deepEqual(result.missingFields, ['booth width', 'venue height limit']);
  assert.equal(item.pendingConfirmations[0]!.message, 'Please provide booth width');

  const none = matchSchemes([candidate], { ...emptyRequirement(), maxHeightMm: 3000 }, 'filtered', false, undefined, [], 'en');
  assert.equal(none.status, 'no_match');
  assert.ok(none.reasons.includes('Exceeds venue height limit: 1 available designs'));
  assert.ok(none.suggestions.includes('You can also contact an advisor to confirm available designs'));
});

test('rule parser clarifications and evidence follow the requested locale', () => {
  const result = parseRequirement('长6米，长7米', emptyRequirement(), catalog, [], 'en');
  assert.equal(result.clarifications[0]!.question, 'The same dimension has multiple values. Please confirm the final value in the form.');
  assert.equal(result.warnings[0]!.message, 'Rule-based recognition was used this time; unrecognized content needs manual confirmation.');
  assert.equal(parseRequirement('长6米，长7米', emptyRequirement(), catalog).clarifications[0]!.question, zh.parseDimMultiple);
});
