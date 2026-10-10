import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogRouteSchema, matchRouteSchema, parseRouteSchema } from '../../src/http/client/selection/schema.js';
import { emptyRequirement, type Candidate, type Catalog } from '../../src/modules/selection/domain.js';
import { matchSchemes } from '../../src/modules/selection/match.js';
import { parseRequirement } from '../../src/modules/selection/parse.js';
import { contractApp } from '../helpers/http-app.js';

// 智选结果结构复杂，直接把纯函数的真实输出经过路由响应 schema 序列化，response-guard 会在字段被丢弃或改类型时失败
const catalog: Catalog = {
  boothSpaces: [{ id: 'size', label: '6 × 3 × 3.5 m', lengthMm: 6000, widthMm: 3000, heightMm: 3500 }],
  openingCounts: [
    {
      id: '2',
      value: '2',
      label: '2面开口',
      labels: { 'zh-CN': '2面开口', en: 'Two sides open' },
      aliases: [{ locale: 'en', text: 'corner' }],
    },
  ],
  productSystems: [{ id: 'fs62', label: 'FS62' }],
  styles: [{ id: 'tech', label: '科技感' }],
  industries: [],
  budgetTiers: [],
  zones: [{ id: 'storage', label: '储藏间' }],
  features: [],
};
const candidate: Candidate = {
  code: 'BOOTH-1',
  specifications: {
    lengthMm: 6000,
    widthMm: 3000,
    heightMm: 3500,
    areaM2: 18,
    openingCount: 2,
    productSystemId: 'fs62',
    productSystemLabel: 'FS62',
  },
  images: [{ assetId: 'asset-1', objectKey: 'renderings/1.png', order: 1, width: 1600, height: 900 }],
  styleId: 'tech',
  industryIds: [],
  budgetTierId: null,
  zoneIds: [],
  featureIds: [],
  keywords: [],
  description: '科技感展台',
};
const identity = { attemptId: 'attempt-1', visitorId: 'v_visitor', dictionaryVersion: 'dict-1' };

async function serialize(response: object, data: unknown) {
  const app = contractApp();
  app.get('/serialize', { schema: { response } }, async () => ({ code: 0, data }));
  const reply = await app.inject('/serialize');
  await app.close();
  assert.equal(reply.statusCode, 200, reply.body);
  return reply.json().data;
}

test('catalog, parse and match responses keep every field the selection module produces', async () => {
  const fullCatalog = { ...catalog, rulesVersion: 'rules-1', dictionaryVersion: 'dict-1' };
  assert.deepEqual(await serialize(catalogRouteSchema.response, fullCatalog), fullCatalog);

  for (const text of ['6×3米，科技感，必须有储藏间', '6×3', '需要奇特舞台']) {
    const parsed = parseRequirement(text, emptyRequirement(), catalog);
    const data = {
      ...parsed,
      parser: 'rules',
      dictionaryVersion: 'dict-1',
      attemptId: 'attempt-1',
      parseId: 'parse-1',
      visitorId: 'v_visitor',
    };
    assert.deepEqual(await serialize(parseRouteSchema.response, data), JSON.parse(JSON.stringify(data)), text);
  }

  const requirement = {
    ...emptyRequirement(),
    boothSpaceId: 'size',
    lengthMm: 6000,
    widthMm: 3000,
    areaM2: 18,
    maxHeightMm: 4000,
    openingCount: 2,
  };
  const rotated = { ...candidate, code: 'ROTATED', specifications: { ...candidate.specifications, lengthMm: 3000, widthMm: 6000 } };
  for (const result of [
    matchSchemes([candidate, rotated], requirement, 'filtered', false, undefined, catalog.boothSpaces),
    matchSchemes([candidate], { ...requirement, boothSpaceId: null, lengthMm: 7000, areaM2: 21 }, 'filtered', true),
    matchSchemes([candidate], emptyRequirement(), 'filtered', false),
    matchSchemes([candidate], emptyRequirement(), 'random', false),
    matchSchemes([], requirement, 'filtered', false, undefined, catalog.boothSpaces),
  ]) {
    const items = result.items.map(item => ({
      ...item,
      images: item.images.map(({ objectKey, ...image }) => ({
        ...image,
        url: `https://s3.example/${objectKey}`,
        thumbnailUrl: `https://s3.example/${objectKey}`,
      })),
    }));
    const data = { ...result, items, ...identity, searchId: 'search-1' };
    assert.deepEqual(await serialize(matchRouteSchema.response, data), JSON.parse(JSON.stringify(data)), result.status);
  }
});
