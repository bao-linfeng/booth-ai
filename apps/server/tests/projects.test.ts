import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { digest, normalizeQuote, type QuoteInput } from '../src/modules/projects/domain.js';
import { resolvePrincipal } from '../src/modules/identity/principal.js';
import { registerQuoteRequestRoutes } from '../src/http/client/quote-requests/index.js';
import { configuredAssignee } from '../src/modules/projects/assignment.js';
import Fastify from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';

export const quoteInput: QuoteInput = { requestKey: 'quote-test-0001', schemeCode: 'TEST-QUOTE', entryPoint: 'scheme_detail',
  exhibition: { name: ' 测试展会 ', countryCode: 'CN', city: '上海', startDate: '2026-11-10', endDate: '2026-11-12' },
  scopeCodes: ['materials'], materialBudget: { currency: 'CNY', amount: '30000.00' }, customerType: 'company', company: '测试公司',
  contact: { name: '测试联系人', email: 'test@example.com' } };
test('quote validates calendar dates, positive budget, scope and international contacts', () => {
  assert.equal(normalizeQuote(quoteInput).materialBudget.amount,'30000');
  assert.equal(normalizeQuote(quoteInput).exhibition.name,'测试展会');
  for (const input of [
    { ...quoteInput, exhibition: { ...quoteInput.exhibition, startDate: '2026-02-30' } },
    { ...quoteInput, exhibition: { ...quoteInput.exhibition, endDate: '2026-11-09' } },
    { ...quoteInput, materialBudget: { currency: 'CNY', amount: '0' } },
    { ...quoteInput, materialBudget: { currency: 'XYZ', amount: '10' } },
    { ...quoteInput, contact: { name: '联系人' } },
    { ...quoteInput, contact: { name: '联系人', phone: '-------' } },
    { ...quoteInput, company: ' ' },
    { ...quoteInput, scopeCodes: ['other'] },
  ]) assert.throws(() => normalizeQuote(input),{ statusCode: 400 });
  assert.equal(normalizeQuote({ ...quoteInput, contact: { name: '联系人', phone: '+44 (20) 1234-5678' } }).contact.phone,'+44 (20) 1234-5678');
});
test('canonical hash is independent of object field order', () => {
  assert.equal(digest({ a: 1, b: { y: 2, x: 1 } }),digest({ b: { x: 1, y: 2 }, a: 1 }));
  assert.notEqual(digest({ amount: '1' }),digest({ amount: '2' }));
});
test('quote identity rejects anonymous, disabled and wrong-site sessions', async () => {
  const pool = { query: async () => ({ rows: [{ enabled: false }] }) } as unknown as pg.Pool;
  const absent = { get: async () => null } as unknown as Redis;
  await assert.rejects(resolvePrincipal(pool,absent,'token','client'),{ statusCode: 401 });
  const session = { get: async () => JSON.stringify({ site: 'client', localId: 'id', sessionVersion: 1, expiresAt: Math.floor(Date.now()/1000)+1000 }), del: async () => 1 } as unknown as Redis;
  await assert.rejects(resolvePrincipal(pool,session,'token','client'),{ statusCode: 403 });
  const wrongSite = { get: async () => JSON.stringify({ site: 'admin', localId: 'id', sessionVersion: 1, expiresAt: Math.floor(Date.now()/1000)+1000 }), del: async () => 1 } as unknown as Redis;
  await assert.rejects(resolvePrincipal(pool,wrongSite,'token','client'),{ statusCode: 401 });
});
test('quote route requires a claim email and own theme results from visitors, and rejects unknown fields and invalid partial theme references', async t => {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await registerQuoteRequestRoutes(app,{ query: async () => ({ rows: [] }) } as unknown as pg.Pool,{ get: async () => null, eval: async () => 1 } as unknown as Redis);
  t.after(() => app.close());
  const phoneOnly = await app.inject({method:'POST',url:'/quote-requests',payload:{...quoteInput,contact:{name:'访客',phone:'+86 138 0000 0000'}}});
  assert.equal(phoneOnly.statusCode,400);
  assert.equal(phoneOnly.json().message,'CLAIM_EMAIL_REQUIRED');
  const themeSelection = { themeJobId: randomUUID(), resultId: randomUUID(), selectionRevision: 1 };
  assert.equal((await app.inject({method:'POST',url:'/quote-requests',payload:{...quoteInput,entryPoint:'theme_result',themeSelection}})).statusCode,401);
  for (const payload of [{...quoteInput,userId:'someone-else'},{...quoteInput,themeSelection:{themeJobId:'partial'}},{...quoteInput,materialBudget:{currency:'CNY',amount:'-1'}}]) {
    assert.equal((await app.inject({method:'POST',url:'/quote-requests',payload})).statusCode,400);
  }
});
test('missing default assignee blocks acceptance rather than returning a phantom project', async () => {
  await assert.rejects(configuredAssignee({ query: async () => ({ rows: [] }) } as unknown as pg.PoolClient),{ statusCode: 503, reason: 'ASSIGNMENT_UNAVAILABLE' });
});
