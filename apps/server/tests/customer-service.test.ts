import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireSubject } from '../src/http/client/customer-service/subject.js';
import { projectSnapshot, schemeSnapshot } from '../src/modules/customer-service/contexts.js';
import { normalizeBody, normalizeEmail, toAdminMessage, toCustomerMessage, type MessageRow } from '../src/modules/customer-service/domain.js';
import { agentEventVisible } from '../src/modules/customer-service/events.js';
import { resolveVisitor } from '../src/modules/customer-service/visitors.js';

const base: MessageRow = {
  id: 'm1', seq: '42', conversationId: 'c1', conversationNo: 'CS-00000001', senderType: 'agent', senderAdminId: 'a1',
  agentNickname: '  ', agentUsername: 'agent.login', customerUsername: 'buyer', kind: 'text', visibility: 'public', body: 'hello',
  locale: 'zh', context: null, eventCode: null, eventParams: null, clientMessageId: '00000000-0000-4000-8000-000000000001',
  createdAt: new Date('2026-10-08T00:00:00Z'), translations: [{ locale: 'en', status: 'done', body: 'hello' }],
};

test('customer DTO drops internal notes, hides agent login names and strips internal event params', () => {
  assert.equal(toCustomerMessage({ ...base, kind: 'note', visibility: 'internal' }), null);
  assert.equal(toCustomerMessage({ ...base, visibility: 'internal' }), null);
  const agent = toCustomerMessage(base)!;
  assert.equal(agent.senderName, null, 'blank nickname falls back to the generic label on the client, never the username');
  assert.equal(agent.seq, 42);
  assert.deepEqual(agent.translation, { locale: 'en', status: 'done', body: 'hello' });
  assert.equal(agent.clientMessageId, null);
  assert.equal(toCustomerMessage({ ...base, senderType: 'customer', senderAdminId: null })!.translation, null, 'customer messages show their own text');
  const transferred = toCustomerMessage({ ...base, senderType: 'system', senderAdminId: null, kind: 'event', eventCode: 'transferred',
    eventParams: { agentName: 'Lily', reason: 'VIP 客户', fromAgentName: 'Tom', byAdminId: 'a2' } })!;
  assert.deepEqual(transferred.eventParams, { agentName: 'Lily' });
  assert.ok(!JSON.stringify(transferred).includes('VIP'));
  const admin = toAdminMessage({ ...base, kind: 'note', visibility: 'internal' });
  assert.equal(admin.senderName, 'agent.login');
  assert.equal(admin.visibility, 'internal');
});

test('context snapshots contain exactly the whitelisted fields', () => {
  const scheme = schemeSnapshot({ code: 'S-001', name: '方案', lengthMm: 6000, widthMm: 3000, openingCount: 2, ...{ cost: 1 } } as never);
  assert.deepEqual(Object.keys(scheme).sort(), ['lengthMm', 'name', 'openingCount', 'schemeCode', 'widthMm']);
  const project = projectSnapshot({ projectNo: 'PJ-00000001', schemeCode: null, sourceType: 'manual_request', status: 'pending', customerType: 'company',
    countryCode: 'DE', city: 'Berlin', exhibitionName: 'IFA', createdAt: new Date('2026-10-08T00:00:00Z'), ...{ contact: { email: 'x@y.z' }, materialBudget: 1 } } as never);
  assert.deepEqual(Object.keys(project).sort(),
    ['city', 'countryCode', 'customerType', 'exhibitionName', 'projectNo', 'schemeCode', 'sourceType', 'status', 'submittedAt']);
  assert.equal(projectSnapshot({ ...project, projectNo: 'PJ-1', createdAt: new Date(), customerType: null, countryCode: null, city: null, exhibitionName: null } as never).customerType, 'individual');
});

test('message bodies are trimmed, keep newlines and reject control characters or overlong text', () => {
  assert.equal(normalizeBody('  a\r\nb\tc  '), 'a\nb\tc');
  for (const value of ['   ', 'a\u0000b', 'a\u001bb', 'x'.repeat(2001)]) assert.throws(() => normalizeBody(value), { reason: 'MESSAGE_INVALID', statusCode: 400 });
  assert.equal(normalizeBody('x'.repeat(2000)).length, 2000);
  assert.equal(normalizeEmail(' Buyer@Example.COM '), 'buyer@example.com');
  assert.equal(normalizeEmail(''), null);
  assert.throws(() => normalizeEmail('not-an-email'), { reason: 'CONTACT_EMAIL_INVALID' });
});

test('workbench events are filtered per connection unless the viewer supervises', () => {
  const event = (agentAdminId: string | null) => JSON.stringify({ type: 'message.created', conversationId: 'c', status: 'active', agentAdminId });
  assert.equal(agentEventVisible(event(null), 'me', false), true);
  assert.equal(agentEventVisible(event('me'), 'me', false), true);
  assert.equal(agentEventVisible(event('other'), 'me', false), false);
  assert.equal(agentEventVisible(event('other'), 'me', true), true);
  assert.equal(agentEventVisible('not json', 'me', false), false);
});

test('subject resolution prefers the signed-in user, validates visitor tokens without touching the database for malformed ones', async () => {
  const queries: string[] = [];
  const pool = { query: async (sql: string) => { queries.push(sql); return sql.startsWith('SELECT id FROM cs_visitors') ? { rows: [{ id: 'v1' }], rowCount: 1 } : { rows: [], rowCount: 0 }; } } as unknown as pg.Pool;
  const user = { principal: { site: 'client', localId: 'u1' }, headers: { 'x-visitor-token': 'a'.repeat(43) } } as unknown as FastifyRequest;
  assert.deepEqual(await requireSubject(user, pool), { kind: 'user', userId: 'u1' });
  assert.equal(queries.length, 0, 'the visitor header is ignored for signed-in requests');
  const anonymous = { principal: null, headers: {}, csVisitorId: null } as unknown as FastifyRequest;
  await assert.rejects(requireSubject(anonymous, pool), { statusCode: 401, reason: 'VISITOR_REQUIRED' });
  assert.equal(await resolveVisitor(pool, 'short'), null);
  assert.equal(await resolveVisitor(pool, ['a'.repeat(43)]), null);
  assert.equal(queries.length, 0);
  const visitor = { principal: null, headers: { 'x-visitor-token': 'b'.repeat(43) }, csVisitorId: null } as unknown as FastifyRequest & { csVisitorId: string | null };
  assert.deepEqual(await requireSubject(visitor, pool), { kind: 'visitor', visitorId: 'v1' });
  assert.equal(visitor.csVisitorId, 'v1', 'visitor id feeds the visitor rate-limit identity');
  assert.ok(queries[0]!.includes('merged_user_id IS NULL') && queries[0]!.includes('deleted_at IS NULL'));
});
