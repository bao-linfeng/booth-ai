import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import type { Redis } from 'ioredis';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createSession, destroySession, encryptJwt, getSession, type SessionSite } from '../../src/infra/session.js';
import { syncClientUser } from '../../src/modules/identity/client-service.js';
import { syncAdmin } from '../../src/modules/identity/admin-service.js';
import { resolvePrincipal } from '../../src/modules/identity/principal.js';
import { getThemeJob, ownedThemeJob, selectThemeResult } from '../../src/modules/generation/theme/queries.js';
import { rateLimitPolicies } from '../../src/http/rate-limits.js';
import { allPermissionCodes } from '../../src/modules/identity/permissions.js';
import { issueEventTicket, registerAuthentication } from '../../src/http/authentication.js';
import Fastify from 'fastify';
import { resolveAdminPermissions } from '../../src/modules/identity/roles.js';

const config = loadConfig({
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only', CORS_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test',
});
const healthy = { database: async () => {}, redis: async () => {}, storage: async () => {} };
const userId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';

async function setup(t: TestContext, site: SessionSite = 'client') {
  const account = { enabled: true, roles: site === 'admin' ? ['ROLE_ADMIN'] : ['ROLE_USER'], sessionVersion: 1 };
  const rolePermissions = { codes: ['bom.read', 'schemes.read', 'dictionaries.read', 'generation.read', 'generation.detail'] };
  const values = new Map<string, string>();
  const counters = new Map<string, number>();
  const reads: string[] = [];
  const queries: string[] = [];
  const pool = { query: async (sql: string, params: unknown[]) => {
    queries.push(sql);
    if (sql.includes('session_version') && sql.startsWith('SELECT')) return { rows: [{ ...account }] };
    if (sql.includes('unnest(permission_codes)')) {
      assert.deepEqual(params, [account.roles]);
      return { rows: rolePermissions.codes.map(code => ({ code })) };
    }
    if (sql.startsWith('UPDATE users SET session_version') || sql.startsWith('UPDATE admins SET session_version')) { account.sessionVersion++; return { rows: [] }; }
    if (sql.includes('user_credit_balances')) { assert.deepEqual(params, [userId]); return { rows: [{ balance: 50 }] }; }
    if (sql.includes('SELECT 1 FROM theme_jobs') || sql.includes('FROM artwork_jobs WHERE id=$1 AND user_id=$2')) return { rows: [{ id: jobId }] };
    if (sql.includes('count(*)::text AS count FROM scheme_boms')) return { rows: [{ count: '0' }] };
    if (sql.includes('FROM scheme_boms b JOIN schemes s')) return { rows: [] };
    if (sql.startsWith('INSERT INTO admin_audit_logs')) { assert.equal(params[0], userId); return { rows: [] }; }
    if (sql.includes('FROM theme_jobs j') || sql.includes('FROM (SELECT a.*,false AS cache_hit')) return { rows: [] };
    throw new Error(`Unexpected business query: ${sql}`);
  } } as unknown as pg.Pool;
  const redis = {
    get: async (key: string) => { reads.push(key); return values.get(key) ?? null; },
    getdel: async (key: string) => { const value = values.get(key) ?? null; values.delete(key); return value; },
    set: async (key: string, value: string) => { values.set(key, value); return 'OK'; },
    del: async (key: string) => Number(values.delete(key)),
    eval: async (_script: string, _count: number, key: string) => { const n = (counters.get(key) ?? 0) + 1; counters.set(key, n); return n; },
  } as unknown as Redis;
  const token = await createSession(redis, { site, localId: userId, externalUserId: 1, username: 'test',
    externalJwtCiphertext: encryptJwt('jwt', config.sessionSecret), loginSource: 'password', sessionVersion: 1 }, 3600, Math.floor(Date.now() / 1000) + 3600);
  const app = await buildApp(config, healthy, { pool, redis, storage: {} } as never);
  t.after(() => app.close());
  return { app, account, rolePermissions, values, counters, reads, queries, pool, redis, token, headers: { authorization: `Bearer ${token}` } };
}

test('disabled client accounts are denied consistently before credits, generation, quotes, history and profile sync', async t => {
  const { app, account, headers, values, queries } = await setup(t);
  account.enabled = false;
  const raw = [...values.values()][0]!;
  const key = [...values.keys()][0]!;
  const routes = [
    { url: '/credits/balance' }, { method: 'POST' as const, url: '/credits/sign-in' },
    { method: 'POST' as const, url: '/theme-offers', payload: {} }, { method: 'POST' as const, url: '/theme-jobs', payload: {} },
    { method: 'POST' as const, url: '/artwork-offers', payload: {} }, { method: 'POST' as const, url: '/artwork-jobs', payload: {} },
    { method: 'POST' as const, url: '/quote-requests', payload: {} }, { method: 'POST' as const, url: '/manual-requests', payload: {} },
    { url: '/me/projects' }, { url: '/me/searches' }, { url: '/me' }, { url: '/catalog/options' },
  ];
  for (const route of routes) {
    values.set(key, raw);
    const result = await app.inject({ ...route, url: `/api/v1/client${route.url}`, headers });
    assert.equal(result.statusCode, 403, `${route.url}: ${result.body}`);
    assert.equal(result.json().error.reason, 'ACCESS_DENIED');
    assert.equal(values.has(key), false);
  }
  assert.equal(queries.length, routes.length);
  assert.ok(queries.every(sql => sql.startsWith('SELECT enabled,roles,session_version')));
});

test('enabled requests read session and account once, and invalid credentials cannot silently become visitors', async t => {
  const { app, headers, reads, queries } = await setup(t);
  const result = await app.inject({ url: '/api/v1/client/credits/balance', headers });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().data.balance, 50);
  assert.equal(reads.length, 1);
  assert.equal(queries.filter(sql => sql.includes('session_version')).length, 1);
  for (const authorization of ['Bearer nonexistent', 'Basic invalid']) {
    const response = await app.inject({ url: '/api/v1/client/catalog/options', headers: { authorization } });
    assert.equal(response.statusCode, 401);
  }
});

test('admin BOM uses the entry principal without repeated session/account reads or external authentication', async t => {
  const { app, headers, reads, queries } = await setup(t, 'admin');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail('BOM route repeated external authentication'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await app.inject({ url: '/api/v1/admin/bill-of-materials', headers });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(reads.length, 1);
  assert.equal(queries.filter(sql => sql.includes('session_version')).length, 1);
  assert.equal(queries.filter(sql => sql.includes('unnest(permission_codes)')).length, 1);
});

test('ROLE_ADMIN without local role grants is denied before business queries and its session is revoked', async t => {
  const { app, headers, rolePermissions, values, queries } = await setup(t, 'admin');
  rolePermissions.codes = [];
  const response = await app.inject({ url: '/api/v1/admin/bill-of-materials', headers });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json().error.reason, 'ACCESS_DENIED');
  assert.equal(values.size, 0);
  assert.equal(queries.length, 2);
  assert.ok(queries[1]?.includes('FROM admin_roles'));
});

test('admin audited business route uses the entry principal without reading Session again', async t => {
  const { app, headers, reads, queries } = await setup(t, 'admin');
  const result = await app.inject({ url: `/api/v1/admin/generation-jobs/${jobId}`, headers });
  assert.equal(result.statusCode, 404, result.body);
  assert.equal(reads.length, 1);
  assert.equal(queries.filter(sql => sql.includes('session_version')).length, 1);
  assert.equal(queries.filter(sql => sql.startsWith('INSERT INTO admin_audit_logs')).length, 1);
});

test('admin disabled state and role removal apply to me and business routes and revoke the presented session', async t => {
  const { app, headers, account, values } = await setup(t, 'admin');
  const key = [...values.keys()][0]!;
  const raw = values.get(key)!;
  for (const disabled of [true, false]) {
    account.enabled = !disabled;
    account.roles = disabled ? ['ROLE_ADMIN'] : [];
    for (const url of ['/api/v1/admin/me', '/api/v1/admin/users']) {
      values.set(key, raw);
      const result = await app.inject({ url, headers });
      assert.equal(result.statusCode, 403);
      assert.equal(values.has(key), false);
    }
  }
});

test('external profile rejection revokes all sessions, while temporary upstream errors preserve them', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const site of ['client', 'admin'] as const) {
    const { app, headers, values, account, redis, token } = await setup(t, site);
    const raw = [...values.values()][0]!;
    const siblingKey = `session:${createHash('sha256').update('sibling').digest('hex').slice(0, 32)}`;
    values.set(siblingKey, raw);
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    assert.equal((await app.inject({ url: `/api/v1/${site}/me`, headers })).statusCode, 502);
    assert.ok(await getSession(redis, token, site));
    assert.equal(account.sessionVersion, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: { id: 1, username: 'test', enabled: false } }));
    const rejected = await app.inject({ url: `/api/v1/${site}/me`, headers });
    assert.equal(rejected.statusCode, site === 'client' ? 403 : 401);
    assert.equal(account.sessionVersion, 2);
    assert.equal(await getSession(redis, token, site), null);
    const sibling = await app.inject({ url: `/api/v1/${site}/me`, headers: { authorization: 'Bearer sibling' } });
    assert.equal(sibling.statusCode, 401);
    assert.equal(values.has(siblingKey), false);
  }
});

test('stale session versions, logout, expiry, malformed sessions and wrong portals are rejected without deleting another portal session', async t => {
  const { app, account, redis, token, headers, values, pool } = await setup(t);
  const wrongPortal = await app.inject({ url: '/api/v1/admin/users', headers });
  assert.equal(wrongPortal.statusCode, 401);
  assert.ok(await getSession(redis, token, 'client'));
  account.sessionVersion = 2;
  assert.equal((await app.inject({ url: '/api/v1/client/credits/balance', headers })).statusCode, 401);
  assert.equal(values.size, 0);
  const expired = await createSession(redis, { site: 'client', localId: userId, externalUserId: 1, username: 'test',
    externalJwtCiphertext: 'cipher', loginSource: 'password', sessionVersion: 2 }, 60, Math.floor(Date.now() / 1000));
  await assert.rejects(resolvePrincipal(pool, redis, expired, 'client'), { statusCode: 401 });
  for (const data of ['{', JSON.stringify({ site: 'client', localId: userId, expiresAt: Math.floor(Date.now() / 1000) + 60 })]) {
    values.set(`session:${createHash('sha256').update('invalid').digest('hex').slice(0, 32)}`, data);
    assert.equal(await getSession(redis, 'invalid', 'client'), null);
  }
  const logout = await app.inject({ method: 'POST', url: '/api/v1/client/auth/logout', headers });
  assert.equal(logout.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/v1/client/credits/balance', headers })).statusCode, 401);
});

test('logout revokes a live Session and remains idempotent', async t => {
  const { app, headers, values } = await setup(t);
  assert.equal((await app.inject({ url: '/api/v1/client/credits/balance', headers })).statusCode, 200);
  for (let n = 0; n < 2; n++) assert.equal((await app.inject({ method: 'POST', url: '/api/v1/client/auth/logout', headers })).statusCode, 200);
  assert.equal(values.size, 0);
  assert.equal((await app.inject({ url: '/api/v1/client/credits/balance', headers })).statusCode, 401);
});

test('theme and artwork event tickets cannot outlive disabled accounts, logout or session version revocation', async t => {
  const { app, account, token, redis, values, headers } = await setup(t);
  const sessionKey = [...values.keys()][0]!;
  const raw = values.get(sessionKey)!;
  for (const kind of ['theme', 'artwork']) {
    for (const revoke of ['disable', 'logout', 'version']) {
      account.enabled = true;
      account.sessionVersion = 1;
      values.set(sessionKey, raw);
      const ticketResult = await app.inject({ method: 'POST', url: `/api/v1/client/${kind}-jobs/${jobId}/events-ticket`, headers });
      assert.equal(ticketResult.statusCode, 200, ticketResult.body);
      const ticket = ticketResult.json().data.ticket;
      if (revoke === 'disable') account.enabled = false;
      if (revoke === 'logout') await destroySession(redis, token);
      if (revoke === 'version') account.sessionVersion = 2;
      const url = `/api/v1/client/${kind}-jobs/${jobId}/events?ticket=${ticket}`;
      const response = await app.inject({ url });
      assert.equal(response.statusCode, revoke === 'disable' ? 403 : 401, response.body);
      assert.equal(values.has(`${kind}-events-ticket:${ticket}`), false);
      assert.equal((await app.inject({ url })).statusCode, 401);
    }
  }
});

test('generalized event tickets bind subject, support visitor tickets on client routes and fixed workbench subject on admin routes', async t => {
  for (const site of ['client', 'admin'] as const) {
    const { pool, redis, token } = await setup(t, site);
    const app = Fastify();
    registerAuthentication(app, pool, redis, site);
    const echo = async (request: { principal: { localId: string } | null; csVisitorId: string | null }) => ({ user: request.principal?.localId ?? null, visitor: request.csVisitorId });
    app.get('/cs/:conversationId/events', { config: { authentication: 'events', eventTicketPrefix: 'cs', eventTicketParam: 'conversationId' } }, echo);
    app.get('/workbench/events', { config: { authentication: 'events', eventTicketPrefix: 'cs-admin', eventTicketParam: null } }, echo);
    t.after(() => app.close());
    const conversationId = randomUUID();
    const visitorId = randomUUID();

    const visitorTicket = await issueEventTicket(redis, 'cs', { subject: conversationId, visitorId });
    const visitor = await app.inject({ url: `/cs/${conversationId}/events?ticket=${visitorTicket}` });
    if (site === 'client') assert.deepEqual(visitor.json(), { user: null, visitor: visitorId });
    else assert.equal(visitor.statusCode, 401, 'visitor tickets are client-only');
    assert.equal((await app.inject({ url: `/cs/${conversationId}/events?ticket=${visitorTicket}` })).statusCode, 401, 'tickets are single-use');

    const mismatched = await issueEventTicket(redis, 'cs', { subject: randomUUID(), visitorId });
    assert.equal((await app.inject({ url: `/cs/${conversationId}/events?ticket=${mismatched}` })).statusCode, 401);
    const anonymous = await issueEventTicket(redis, 'cs', { subject: conversationId });
    assert.equal((await app.inject({ url: `/cs/${conversationId}/events?ticket=${anonymous}` })).statusCode, 401);
    const wrongPrefix = await issueEventTicket(redis, 'theme', { subject: conversationId, visitorId });
    assert.equal((await app.inject({ url: `/cs/${conversationId}/events?ticket=${wrongPrefix}` })).statusCode, 401);

    const user = await issueEventTicket(redis, 'cs', { subject: conversationId, userId, token });
    if (site === 'client') assert.deepEqual((await app.inject({ url: `/cs/${conversationId}/events?ticket=${user}` })).json(), { user: userId, visitor: null });
    const workbench = await issueEventTicket(redis, 'cs-admin', { subject: 'workbench', userId, token });
    assert.deepEqual((await app.inject({ url: `/workbench/events?ticket=${workbench}` })).json(), { user: userId, visitor: null });
    const otherUser = await issueEventTicket(redis, 'cs-admin', { subject: 'workbench', userId: randomUUID(), token });
    assert.equal((await app.inject({ url: `/workbench/events?ticket=${otherUser}` })).statusCode, 401);
    const wrongSubject = await issueEventTicket(redis, 'cs-admin', { subject: conversationId, userId, token });
    assert.equal((await app.inject({ url: `/workbench/events?ticket=${wrongSubject}` })).statusCode, 401);
  }
});

test('login/sync limits share one budget and private operations enforce configured limits before business work', async t => {
  const { app, headers, counters } = await setup(t);
  for (let n = 0; n < rateLimitPolicies.login.max; n++) {
    const response = await app.inject({ method: 'POST', url: `/api/v1/client/auth/${n % 2 ? 'sync' : 'login'}`, payload: {} });
    assert.equal(response.statusCode, 400);
  }
  const limited = await app.inject({ method: 'POST', url: '/api/v1/client/auth/login', payload: {} });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['retry-after'], '60');
  for (const [name, url, payload] of [
    ['generation', '/theme-offers', { schemeCode: 'S', sourceAssetId: 'source' }],
    ['generation', '/artwork-offers', { schemeCode: 'S', themeJobId: jobId, resultId: jobId, selectionRevision: 1 }],
    ['quote', '/quote-requests', { requestKey: 'request-test', schemeCode: 'S', entryPoint: 'scheme_detail',
      exhibition: { name: 'Exhibition', countryCode: 'CN', city: 'Shanghai', startDate: '2026-11-01', endDate: '2026-11-02' },
      scopeCodes: ['materials'], materialBudget: { currency: 'CNY', amount: '10' }, customerType: 'company', company: 'Test', contact: { name: 'Test', email: 'test@example.com' } }],
  ] as const) {
    const window = Math.floor(Date.now() / 60000);
    counters.set(`rate:client:${name}:${createHash('sha256').update(userId).digest('hex')}:${window}`, rateLimitPolicies[name].max);
    const response = await app.inject({ method: 'POST', url: `/api/v1/client${url}`, payload, headers });
    assert.equal(response.statusCode, 429, response.body);
    assert.equal(response.json().error.reason, 'RATE_LIMITED');
    assert.equal(response.headers['retry-after'], '60');
  }
});

test('theme ownership remains enforced through direct business-service calls', async () => {
  const pool = { query: async (_sql: string, params: unknown[]) => { assert.deepEqual(params, [jobId, userId]); return { rows: [] }; } } as unknown as pg.Pool;
  await assert.rejects(ownedThemeJob(pool, userId, jobId), { statusCode: 404 });
  await assert.rejects(getThemeJob(pool, userId, jobId), { statusCode: 404 });
  await assert.rejects(selectThemeResult(pool, userId, jobId, randomUUID(), 1), { statusCode: 404 });
});

test('real SQL: disable/re-enable, role removal and identity changes invalidate sessions, and profile sync cannot re-enable accounts',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL }, async t => {
    const schema = `auth_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
    for (const name of ['001_foundation.sql', '002_auth.sql', '043_user_login_source.sql', '051_account_session_versions.sql', '059_admin_role_permissions.sql', '060_editable_admin_role.sql', '076_user_type.sql']) {
      await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const detail = { externalUserId: 1, username: 'test', nickname: null, email: null, mobile: null, avatarPath: null,
      company: null, country: null, city: null, languageCode: null, enabled: true, roles: ['ROLE_ADMIN'], permissions: [] };
    const client = await syncClientUser(pool, detail, true, 'password');
    assert.equal(client.type, 'client');
    const su = await syncClientUser(pool, detail, true, 'sso_token', 'su');
    assert.equal(su.id, client.id);
    assert.equal(su.type, 'su');
    assert.equal((await syncClientUser(pool, detail, false)).type, 'su');
    assert.equal((await syncClientUser(pool, detail, true, 'password', 'client')).type, 'client');
    const admin = await syncAdmin(pool, detail, true);
    // 只执行到 060：ROLE_ADMIN 拥有 060 授予且仍在权限目录中的权限码
    const seeded = (await pool.query<{ permission_codes: string[] }>("SELECT permission_codes FROM admin_roles WHERE name='ROLE_ADMIN'")).rows[0]!.permission_codes;
    const expected = seeded.filter(code => allPermissionCodes.includes(code)).sort();
    assert.ok(expected.length > 0);
    assert.deepEqual((await resolveAdminPermissions(pool, ['ROLE_ADMIN'])).sort(), expected);
    assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_UNCONFIGURED']), []);
    const values = new Map<string, string>();
    const redis = { set: async (key: string, value: string) => { values.set(key, value); return 'OK'; },
      get: async (key: string) => values.get(key) ?? null, del: async (key: string) => Number(values.delete(key)) } as unknown as Redis;
    for (const [site, account, table] of [['client', client, 'users'], ['admin', admin, 'admins']] as const) {
      const token = await createSession(redis, { site, localId: account.id, sessionVersion: account.sessionVersion,
        externalUserId: 1, username: 'test', externalJwtCiphertext: 'cipher', loginSource: 'password' }, 3600, Math.floor(Date.now() / 1000) + 3600);
      assert.ok(await resolvePrincipal(pool, redis, token, site));
      await pool.query(`UPDATE ${table} SET enabled=false WHERE id=$1`, [account.id]);
      if (site === 'client') await assert.rejects(syncClientUser(pool, detail, false), { statusCode: 403 });
      else await assert.rejects(syncAdmin(pool, detail, false), { statusCode: 403 });
      await pool.query(`UPDATE ${table} SET enabled=true WHERE id=$1`, [account.id]);
      await assert.rejects(resolvePrincipal(pool, redis, token, site), { statusCode: 401 });
      assert.equal((await pool.query(`SELECT session_version FROM ${table} WHERE id=$1`, [account.id])).rows[0].session_version, 2);
    }
    await pool.query('UPDATE admins SET roles=ARRAY[]::text[] WHERE id=$1', [admin.id]);
    assert.equal((await pool.query('SELECT session_version FROM admins WHERE id=$1', [admin.id])).rows[0].session_version, 3);
    await pool.query("UPDATE admins SET roles=ARRAY['ROLE_ADMIN'] WHERE id=$1", [admin.id]);
    assert.equal((await pool.query('SELECT session_version FROM admins WHERE id=$1', [admin.id])).rows[0].session_version, 4);
    await pool.query('UPDATE users SET external_user_id=2 WHERE id=$1', [client.id]);
    assert.equal((await pool.query('SELECT session_version FROM users WHERE id=$1', [client.id])).rows[0].session_version, 3);
    await pool.query("UPDATE admin_roles SET permission_codes='{}' WHERE name='ROLE_ADMIN'");
    assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN']), []);
    await syncAdmin(pool, detail, true);
    assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN']), []);
    const deniedToken = await createSession(redis, { site: 'admin', localId: admin.id, sessionVersion: 4,
      externalUserId: 1, username: 'test', externalJwtCiphertext: 'cipher', loginSource: 'password' }, 3600, Math.floor(Date.now() / 1000) + 3600);
    await assert.rejects(resolvePrincipal(pool, redis, deniedToken, 'admin'), { statusCode: 403 });
    assert.equal(await getSession(redis, deniedToken, 'admin'), null);
  });
