import assert from 'node:assert/strict';
import test from 'node:test';
import { getDashboardSummary } from '../src/modules/dashboard/service.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

test('dashboard does not query or expose business data without module grants', async () => {
  const pool = { query: async () => { throw new Error('Must not query unauthorized data'); } } as never;
  const result = await getDashboardSummary(pool, ['dashboard.read']);
  assert.equal(result.projects, null);
  assert.equal(result.schemes, null);
  assert.equal(result.generation, null);
  assert.equal(result.notifications, null);
});

test('dashboard route requires a homepage grant and filters data by business grants', async t => {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test',
    REDIS_URL: 'redis://localhost', S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000',
    S3_BUCKET: 'test', S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only', CORS_ORIGINS: 'http://localhost:5173',
    SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test' });
  let permissions = ['projects.read'];
  const businessQueries: string[] = [];
  const app = await buildApp(config, { database: async () => {}, redis: async () => {}, storage: async () => {} }, {
    pool: { query: async (sql: string) => {
      if (sql.includes('FROM admins WHERE id=')) return { rows: [{ enabled: true, roles: ['test'], sessionVersion: 1 }] };
      if (sql.includes('unnest(permission_codes)')) return { rows: permissions.map(code => ({ code })) };
      businessQueries.push(sql);
      if (sql.includes('FROM schemes')) return { rows: [{ unverified: 7 }] };
      throw new Error('Unexpected business query');
    } },
    redis: { get: async () => JSON.stringify({ site: 'admin', localId: 'admin-id', sessionVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 60 }) },
    storage: {},
  } as never);
  t.after(() => app.close());
  const url = '/api/v1/admin/dashboard/summary';
  const headers = { authorization: 'Bearer test-token' };
  assert.equal((await app.inject(url)).statusCode, 401);
  assert.equal((await app.inject({ url, headers })).statusCode, 403);
  assert.equal(businessQueries.length, 0);
  for (const homeGrant of ['dashboard.read', 'workspace.read']) {
    permissions = [homeGrant];
    const response = await app.inject({ url, headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.projects, null);
    assert.equal(response.headers['cache-control'], 'private, no-store');
  }
  assert.equal(businessQueries.length, 0);
  permissions = ['workspace.read', 'schemes.read'];
  const response = await app.inject({ url, headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.schemes, { unverified: 7 });
  assert.equal(response.json().data.projects, null);
  assert.equal(response.json().data.generation, null);
  assert.equal(response.json().data.notifications, null);
  assert.equal(businessQueries.length, 1);
});

test('analytics route requires the analytics page grant and only queries granted modules', async t => {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test',
    REDIS_URL: 'redis://localhost', S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000',
    S3_BUCKET: 'test', S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only', CORS_ORIGINS: 'http://localhost:5173',
    SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test' });
  let permissions = ['workspace.read'];
  const businessQueries: string[] = [];
  const boundsDays: unknown[] = [];
  const app = await buildApp(config, { database: async () => {}, redis: async () => {}, storage: async () => {} }, {
    pool: { query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM admins WHERE id=')) return { rows: [{ enabled: true, roles: ['test'], sessionVersion: 1 }] };
      if (sql.includes('unnest(permission_codes)')) return { rows: permissions.map(code => ({ code })) };
      if (sql.includes('generate_series')) {
        boundsDays.push(values?.[0]);
        return { rows: [{ startAt: new Date('2026-10-01T00:00:00Z'), monthStartAt: new Date('2025-11-01T00:00:00Z'),
          dates: ['2026-10-06', '2026-10-07'], months: ['2026-09', '2026-10'] }] };
      }
      businessQueries.push(sql);
      if (!sql.includes('FROM users')) throw new Error('Unexpected business query');
      if (sql.includes('GROUP BY 1')) return { rows: [{ date: '2026-10-07', count: 3 }] };
      return { rows: [{ value: 3, total: 9 }] };
    } },
    redis: { get: async () => JSON.stringify({ site: 'admin', localId: 'admin-id', sessionVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 60 }) },
    storage: {},
  } as never);
  t.after(() => app.close());
  const url = '/api/v1/admin/dashboard/analytics';
  const headers = { authorization: 'Bearer test-token' };
  assert.equal((await app.inject(url)).statusCode, 401);
  assert.equal((await app.inject({ url, headers })).statusCode, 403);
  permissions = ['dashboard.read'];
  assert.equal((await app.inject({ url: `${url}?days=14`, headers })).statusCode, 400);
  const empty = (await app.inject({ url, headers })).json().data;
  assert.deepEqual([empty.overview, empty.trend, empty.funnel, empty.monthlyProjects, empty.projectStatuses, empty.generationStatuses],
    [[], [], [], null, null, null]);
  assert.equal(businessQueries.length, 0);
  permissions = ['dashboard.read', 'users.read'];
  const response = await app.inject({ url: `${url}?days=7`, headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  const data = response.json().data;
  assert.equal(data.days, 7);
  assert.deepEqual(data.dates, ['2026-10-06', '2026-10-07']);
  assert.deepEqual(data.overview, [{ key: 'users', value: 3, total: 9 }]);
  assert.deepEqual(data.trend, [{ key: 'users', data: [0, 3] }]);
  assert.deepEqual(data.funnel, []);
  assert.deepEqual(boundsDays, [30, 7]);
});
