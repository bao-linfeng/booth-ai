import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { ERROR_CODES } from '../../src/http/errors.js';
import { adminCurrentUserSchema, currentUserSchema, successResponse } from '../../src/http/schemas.js';
import { toCurrentUser } from '../../src/modules/identity/service.js';
import { domainError } from '../../src/lib/errors.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://localhost/test',
  REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:19000',
  S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'test-only',
  S3_SECRET_KEY: 'test-only',
  CORS_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes',
  AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
  EXTERNAL_API_URL: 'https://api.example.test',
});
const healthy = { database: async () => {}, redis: async () => {}, storage: async () => {} };
const dependencies = {
  pool: { query: async () => ({ rows: [] }) },
  redis: { get: async () => null },
  storage: {},
} as unknown as NonNullable<Parameters<typeof buildApp>[2]>;

test('unknown routes and thrown errors share one error shape with only declared fields', async t => {
  const app = await buildApp(config, healthy);
  t.after(() => app.close());
  app.post('/test-domain', { schema: { body: { type: 'object' } } }, async () => {
    throw Object.assign(domainError('INVALID_PROMPT_TEMPLATE', 400), {
      details: { issues: [{ code: 'UNKNOWN_VARIABLE' }] },
      issues: ['legacy'],
    });
  });
  const missing = await app.inject('/api/v1/client/not-a-route');
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), {
    error: { code: 'REQUEST_ERROR', reason: 'ROUTE_NOT_FOUND', message: 'Route not found', requestId: missing.headers['x-request-id'] },
  });
  const domain = await app.inject({ method: 'POST', url: '/test-domain', payload: {} });
  assert.equal(domain.statusCode, 400);
  assert.deepEqual(domain.json(), {
    error: {
      code: 'REQUEST_ERROR',
      reason: 'INVALID_PROMPT_TEMPLATE',
      details: { issues: [{ code: 'UNKNOWN_VARIABLE' }] },
      message: 'Invalid request',
      requestId: domain.headers['x-request-id'],
    },
  });
  for (const response of [missing, domain]) assert.ok(ERROR_CODES.includes(response.json().error.code));
});

test('every business route documents the shared error response, and auth routes document their success payload', async t => {
  const app = await buildApp(config, healthy, dependencies);
  t.after(() => app.close());
  const spec = (await app.inject('/openapi.json')).json() as {
    paths: Record<string, Record<string, { responses?: Record<string, { content?: { 'application/json'?: { schema?: unknown } } }> }>>;
  };
  const missing: string[] = [];
  for (const [path, operations] of Object.entries(spec.paths)) {
    if (!path.startsWith('/api/v1/')) continue;
    for (const [method, operation] of Object.entries(operations)) {
      const responses = operation.responses ?? {};
      if (!responses['4XX']?.content?.['application/json']?.schema || !responses['5XX']?.content?.['application/json']?.schema)
        missing.push(`${method.toUpperCase()} ${path}`);
    }
  }
  assert.deepEqual(missing, []);
  for (const path of ['/api/v1/client/auth/login', '/api/v1/client/auth/sync', '/api/v1/admin/auth/login']) {
    assert.ok(spec.paths[path]?.post?.responses?.['200']?.content?.['application/json']?.schema, path);
  }
  for (const path of ['/api/v1/client/me', '/api/v1/admin/me'])
    assert.ok(spec.paths[path]?.get?.responses?.['200']?.content?.['application/json']?.schema, path);
});

test('current user schemas declare every field the identity module produces, so serialization never drops one', () => {
  const detail = {
    externalUserId: 1,
    username: 'u',
    nickname: null,
    email: null,
    mobile: null,
    avatarPath: null,
    company: null,
    country: null,
    city: null,
    languageCode: null,
    enabled: true,
    roles: [],
    permissions: [],
  };
  const declared = Object.keys(currentUserSchema.properties);
  assert.deepEqual(
    Object.keys(toCurrentUser('id', detail, 'client', 'password', 'su')).filter(key => !declared.includes(key)),
    [],
  );
  assert.deepEqual(
    Object.keys(toCurrentUser('id', detail, 'admin', 'sso_token')).filter(key => !declared.includes(key)),
    [],
  );
  assert.ok('homePath' in adminCurrentUserSchema.properties);
});

test('in tests the response guard fails a route whose response schema drops or coerces fields', async t => {
  const app = await buildApp(config, healthy);
  t.after(() => app.close());
  const response = { 200: successResponse({ type: 'object', properties: { id: { type: 'string' } } }) };
  app.get('/test-drops', { schema: { response } }, async () => ({ code: 0, data: { id: 'a', secretlyAdded: true } }));
  app.get('/test-coerces', { schema: { response } }, async () => ({ code: 0, data: { id: 1 } }));
  app.get('/test-matches', { schema: { response } }, async () => ({ code: 0, data: { id: 'a' } }));
  assert.equal((await app.inject('/test-drops')).statusCode, 500);
  assert.equal((await app.inject('/test-coerces')).statusCode, 500);
  const ok = await app.inject('/test-matches');
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { code: 0, data: { id: 'a' } });
});
