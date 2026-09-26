import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const env = {
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only', CORS_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', EXTERNAL_API_URL: 'https://api.example.test',
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

test('configuration fails closed without printing supplied secrets', () => {
  assert.throws(() => loadConfig({ ...env, DATABASE_URL: 'sensitive-invalid-value' }), /Invalid URL environment variable: DATABASE_URL/);
  assert.throws(() => loadConfig({ ...env, S3_SECRET_KEY: '' }), /Missing environment variable: S3_SECRET_KEY/);
  assert.throws(() => loadConfig({ ...env, PORT: '0' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ ...env, CORS_ORIGINS: '*' }), /Invalid CORS_ORIGINS/);
});
