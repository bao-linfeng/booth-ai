import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { encryptJwt } from '../src/infra/session.js';

const env = {
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only', CORS_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test',
};
const config = loadConfig(env);
const healthy = { database: async () => {}, redis: async () => {}, storage: async () => {} };

test('liveness is independent; readiness returns 503 without exposing dependency errors', async t => {
  const app = await buildApp(config, { ...healthy, database: async () => { throw new Error('private-connection-details'); } });
  t.after(() => app.close());
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  const response = await app.inject('/health/ready');
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'degraded', checks: { database: 'error', redis: 'ok', storage: 'ok' } });
  assert.ok(!response.body.includes('private-connection-details'));
});

test('readiness bounds a stalled dependency', async t => {
  const app = await buildApp(config, { ...healthy, redis: () => new Promise(() => {}) });
  t.after(() => app.close());
  const response = await app.inject('/health/ready');
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.redis, 'error');
});

test('request IDs, explicit CORS, input validation and errors', async t => {
  const app = await buildApp(config, healthy);
  t.after(() => app.close());
  app.post('/test-validation', {
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1 } } } },
  }, async () => ({ ok: true }));
  app.get('/test-error', async () => { throw new Error('private-password'); });
  const response = await app.inject({ url: '/health/ready', headers: { origin: 'http://localhost:5173', 'x-request-id': 'untrusted' } });
  assert.equal(response.statusCode, 200);
  assert.notEqual(response.headers['x-request-id'], 'untrusted');
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
  const deniedOrigin = await app.inject({ url: '/health/live', headers: { origin: 'https://untrusted.example' } });
  assert.equal(deniedOrigin.headers['access-control-allow-origin'], undefined);
  const invalid = await app.inject({ method: 'POST', url: '/test-validation', payload: { name: 'valid', extra: true } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'VALIDATION_ERROR');
  const internal = await app.inject('/test-error');
  assert.equal(internal.statusCode, 500);
  assert.ok(!internal.body.includes('private-password'));
  assert.equal(internal.json().error.requestId, internal.headers['x-request-id']);
  assert.equal((await app.inject('/api/v1/admin/not-implemented')).statusCode, 404);
});

test('OpenAPI documents real health routes; docs assets load', async t => {
  const app = await buildApp(config, healthy);
  t.after(() => app.close());
  const spec = await app.inject('/openapi.json');
  assert.equal(spec.statusCode, 200);
  assert.ok(spec.json().paths['/health/ready']);
  assert.equal((await app.inject('/docs/')).statusCode, 200);
  assert.equal((await app.inject('/docs/static/swagger-ui-bundle.js')).statusCode, 200);
});

test('production does not expose development documentation', async t => {
  const app = await buildApp({ ...config, nodeEnv: 'production' }, healthy);
  t.after(() => app.close());
  assert.equal((await app.inject('/docs/')).statusCode, 404);
  assert.equal((await app.inject('/openapi.json')).statusCode, 404);
});

test('admin business routes reject missing sessions before accessing data', async t => {
  const app = await buildApp(config, healthy, {
    pool: { query: async () => { throw new Error('database should not be queried'); } },
    redis: { get: async () => null },
    storage: {},
  } as unknown as NonNullable<Parameters<typeof buildApp>[2]>);
  t.after(() => app.close());
  for (const [method,path] of [['GET','/api/v1/admin/schemes'],['GET','/api/v1/admin/schemes/example/bill-of-materials'],['GET','/api/v1/admin/schemes/example/bill-of-materials/download?revision=1'],['DELETE','/api/v1/admin/schemes/example/bill-of-materials?expectedRevision=1'],['DELETE','/api/v1/admin/schemes/example/bill-of-materials/items/123e4567-e89b-12d3-a456-426614174000?expectedRevision=1']]) {
    const response = await app.inject({ method: method as 'DELETE' | 'GET', url: path! });
    assert.equal(response.statusCode, 401, path);
    assert.equal(response.json().error.reason, 'AUTH_REQUIRED');
  }
});

test('administrator can list BOMs without external scheme permissions', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: {
    id: 1, username: 'admin', enabled: true, roles: [{ name: 'ROLE_ADMIN', roleEntityPermissions: [] }],
  } }), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });
  const app = await buildApp(config, healthy, {
    pool: { query: async (sql: string) => {
      if (sql.includes('INSERT INTO admins')) return { rows: [{ id: 'admin-id' }] };
      if (sql.includes('FROM admins WHERE id=')) return { rows: [{ enabled: true, roles: ['ROLE_ADMIN'] }] };
      if (sql.includes('count(*)::text AS count FROM scheme_boms')) return { rows: [{ count: '0' }] };
      if (sql.includes('FROM scheme_boms b JOIN schemes s')) return { rows: [] };
      throw new Error('Unexpected query');
    } },
    redis: { get: async () => JSON.stringify({ site: 'admin', localId: 'admin-id', externalUserId: 1,
      username: 'admin', externalJwtCiphertext: encryptJwt('jwt', config.sessionSecret), expiresAt: Math.floor(Date.now() / 1000) + 60 }) },
    storage: {},
  } as unknown as NonNullable<Parameters<typeof buildApp>[2]>);
  t.after(() => app.close());
  const response = await app.inject({ url: '/api/v1/admin/bill-of-materials?page=1&pageSize=20', headers: { authorization: 'Bearer test-token' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, { data: [], total: 0 });
});

test('configuration fails closed without printing supplied secrets', () => {
  assert.throws(() => loadConfig({ ...env, DATABASE_URL: 'sensitive-invalid-value' }), /Invalid URL environment variable: DATABASE_URL/);
  assert.throws(() => loadConfig({ ...env, S3_SECRET_KEY: '' }), /Missing environment variable: S3_SECRET_KEY/);
  assert.throws(() => loadConfig({ ...env, PORT: '0' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ ...env, CORS_ORIGINS: '*' }), /Invalid CORS_ORIGINS/);
  assert.throws(() => loadConfig({ ...env, AI_MODEL_ENCRYPTION_KEY: 'sensitive-invalid-value' }), /Invalid AI_MODEL_ENCRYPTION_KEY/);
});
