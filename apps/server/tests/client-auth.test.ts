import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { decryptJwt, getSession } from '../src/infra/session.js';

const config = loadConfig({
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only', CORS_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test',
});
const healthy = { database: async () => {}, redis: async () => {}, storage: async () => {} };
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
function externalToken(username: string, exp = expiresAt) {
  return `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: username, exp })).toString('base64url')}.test-signature`;
}
const profile = {
  id: 123, username: 'user+demo', nickname: '演示用户', email: 'Demo@Example.test', enabled: true, fkAvatarId: 7,
  password: 'private-password-hash', roles: [{ name: 'ROLE_USER', roleEntityPermissions: [] }],
};

async function setup(t: TestContext) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const sessions = new Map<string, string>();
  const dependencies = {
    pool: { query: async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      if (sql.includes('INSERT INTO users')) return { rows: [{ id: 'local-user-id', enabled: true, sessionVersion: 1 }] };
      if (sql.includes('FROM users WHERE id=')) return { rows: [{ enabled: true, roles: ['ROLE_USER'], sessionVersion: 1 }] };
      if (sql.startsWith('UPDATE selection_')) return { rows: [] };
      if (sql.includes('UPDATE projects SET customer_user_id')) return { rows: [] };
      throw new Error('Unexpected query');
    } },
    redis: {
      eval: async () => 1,
      set: async (key: string, value: string) => { sessions.set(key, value); return 'OK'; },
      get: async (key: string) => sessions.get(key) ?? null,
      del: async (key: string) => { sessions.delete(key); return 1; },
    }, storage: {},
  } as unknown as NonNullable<Parameters<typeof buildApp>[2]>;
  const app = await buildApp(config, healthy, dependencies);
  t.after(() => app.close());
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  return { app, dependencies, queries, sessions };
}

test('external token login wraps the profile, synchronizes the visitor and creates a usable local session', async t => {
  const { app, dependencies, queries, sessions } = await setup(t);
  const token = externalToken(profile.username);
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ success: true, data: profile }), { status: 200 });
  };
  const response = await app.inject({
    method: 'POST', url: '/api/v1/client/auth/sync', payload: { username: profile.username, token },
    headers: { 'x-visitor-id': 'visitor_test_123456789' },
  });
  assert.equal(response.statusCode, 200);
  const result = response.json();
  assert.equal(result.code, 0);
  assert.equal(result.data.expiresAt, expiresAt);
  assert.equal(result.data.user.id, 'local-user-id');
  assert.equal(result.data.user.username, profile.username);
  assert.equal(result.data.user.nickname, profile.nickname);
  assert.equal(result.data.user.accountType, 'client');
  assert.equal(result.data.user.externalUserId, '123');
  assert.equal(result.data.user.avatarPath, 'https://api.example.test/api/attachment/images/7');
  assert.equal(requests[0]?.url, 'https://api.example.test/api/user/username/user%2Bdemo');
  assert.equal(new Headers(requests[0]?.init?.headers).get('authorization'), `Bearer ${token}`);
  assert.equal(queries[0]?.values[0], 123);
  assert.equal(queries[0]?.values[13], true);
  assert.equal(queries.filter(query => query.sql.startsWith('UPDATE selection_')).length, 3);
  assert.deepEqual(queries.find(query => query.sql.includes('UPDATE projects SET customer_user_id'))?.values, ['local-user-id', 'demo@example.test']);
  assert.equal(sessions.size, 1);
  const session = await getSession(dependencies.redis, result.data.accessToken, 'client');
  assert.ok(session);
  assert.equal(session.localId, 'local-user-id');
  assert.equal(decryptJwt(session.externalJwtCiphertext, config.sessionSecret), token);
  assert.ok(!response.body.includes(token));
  assert.ok(!response.body.includes(profile.password));
  assert.ok(!queries.some(query => query.values.includes(token) || query.values.includes(profile.password)));

  const me = await app.inject({ url: '/api/v1/client/me', headers: { authorization: `Bearer ${result.data.accessToken}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().data.id, 'local-user-id');
});

test('external login rejects missing fields, invalid and expired tokens, and username substitution before querying a profile', async t => {
  const { app, queries, sessions } = await setup(t);
  globalThis.fetch = async () => { throw new Error('External profile should not be requested'); };
  for (const payload of [{ token: 'token' }, { username: profile.username }, { username: profile.username, token: '' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/client/auth/sync', payload });
    assert.equal(response.statusCode, 400);
  }
  for (const token of ['not-a-jwt', externalToken('another-user'), externalToken(profile.username, 1)]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/client/auth/sync', payload: { username: profile.username, token } });
    assert.equal(response.statusCode, 401);
    assert.ok(!response.body.includes(token));
  }
  assert.equal(queries.length, 0);
  assert.equal(sessions.size, 0);
});

test('external login relies on upstream authentication and rejects disabled or mismatched profiles without creating a session', async t => {
  const { app, queries, sessions } = await setup(t);
  const scenarios = [
    { status: 401, body: 'Unauthorized', expected: 401 },
    { status: 403, body: 'Forbidden', expected: 403 },
    { status: 503, body: '{}', expected: 502 },
    { status: 200, body: JSON.stringify({ success: false }), expected: 502 },
    { status: 200, body: JSON.stringify({ success: true, data: { ...profile, enabled: false } }), expected: 403 },
    { status: 200, body: JSON.stringify({ success: true, data: { ...profile, username: 'another-user' } }), expected: 401 },
  ];
  for (const scenario of scenarios) {
    globalThis.fetch = async () => new Response(scenario.body, { status: scenario.status });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/client/auth/sync', payload: { username: profile.username, token: externalToken(profile.username) },
    });
    assert.equal(response.statusCode, scenario.expected);
  }
  assert.equal(queries.length, 0);
  assert.equal(sessions.size, 0);
});

test('password login still returns the same local session and user contract', async t => {
  const { app, sessions } = await setup(t);
  const token = externalToken(profile.username);
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).includes('/api/auth/login')
    ? { success: true, code: '200', data: { JWT: token, data: { id: profile.id, username: profile.username } } }
    : { success: true, data: profile }), { status: 200 });
  const response = await app.inject({ method: 'POST', url: '/api/v1/client/auth/login', payload: { username: profile.username, password: 'test-password' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.user.id, 'local-user-id');
  assert.equal(sessions.size, 1);
});

test('user synchronization failure does not establish an external login session', async t => {
  const { app, dependencies, sessions } = await setup(t);
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: profile }), { status: 200 });
  dependencies.pool.query = (async () => { throw new Error('private-database-details'); }) as typeof dependencies.pool.query;
  const response = await app.inject({
    method: 'POST', url: '/api/v1/client/auth/sync', payload: { username: profile.username, token: externalToken(profile.username) },
  });
  assert.equal(response.statusCode, 500);
  assert.equal(sessions.size, 0);
  assert.ok(!response.body.includes('private-database-details'));
});
