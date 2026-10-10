import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { registerAdminAiModelRoutes } from '../../src/http/admin/ai-models/index.js';
import { normalizeParams } from '../../src/infra/ai/protocols.js';
import type { ModelKind } from '../../src/infra/ai/types.js';
import { contractApp } from '../helpers/http-app.js';

const id = '00000000-0000-4000-8000-000000000001';

async function schemaApp(t: TestContext, kind: ModelKind = 'text') {
  const app = contractApp();
  t.after(() => app.close());
  const received: Record<string, unknown>[] = [];
  app.addHook('onRoute', route => {
    if (route.url !== '/ai-models' && route.url !== '/ai-models/:id') return;
    if (route.method !== 'POST' && route.method !== 'PUT') return;
    // 替换后的 handler 直接返回规范化后的参数，不再符合路由的成功响应 schema，只保留请求校验
    const { response: _response, ...schema } = route.schema ?? {};
    route.schema = schema;
    route.handler = async request => {
      const body = request.body as { params: Record<string, unknown> };
      received.push(structuredClone(body.params));
      try {
        return { code: 0, data: normalizeParams('openai', kind, body.params) };
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error('Invalid model parameter'), {
          statusCode: 400,
          reason: 'PARAMS_INVALID',
        });
      }
    };
  });
  await registerAdminAiModelRoutes(app, {} as pg.Pool, {} as Redis, 'a'.repeat(64));
  return { app, received };
}

for (const temperature of [0, 0.2, 1]) {
  test(`model create and update schemas preserve numeric temperature ${temperature}`, async t => {
    const { app, received } = await schemaApp(t);
    for (const method of ['POST', 'PUT'] as const) {
      const response = await app.inject({
        method,
        url: method === 'POST' ? '/ai-models' : `/ai-models/${id}`,
        payload: {
          model: 'test-model',
          params: { temperature },
          enabled: true,
          ...(method === 'POST' ? { providerId: id, kind: 'text' } : { expectedRevision: 1 }),
        },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().data, { temperature, jsonMode: 'on' });
      assert.deepEqual(received.at(-1), { temperature });
      assert.equal(typeof received.at(-1)?.temperature, 'number');
    }
    assert.equal(received.length, 2);
  });
}

test('image model create schema preserves string quality enums', async t => {
  const { app, received } = await schemaApp(t, 'image');
  const response = await app.inject({
    method: 'POST',
    url: '/ai-models',
    payload: { providerId: id, kind: 'image', model: 'test-model', params: { quality: 'high' }, enabled: true },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().data, { quality: 'high' });
  assert.deepEqual(received, [{ quality: 'high' }]);
});

test('string temperature passes schema but fails parameter normalization', async t => {
  const { app, received } = await schemaApp(t);
  const response = await app.inject({
    method: 'POST',
    url: '/ai-models',
    payload: { providerId: id, kind: 'text', model: 'test-model', params: { temperature: 'abc' }, enabled: true },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().error.code, 'REQUEST_ERROR');
  assert.equal(response.json().error.reason, 'PARAMS_INVALID');
  assert.deepEqual(received, [{ temperature: 'abc' }]);
});

test('default coercion still converts boolean temperature before normalization rejects it', async t => {
  const { app, received } = await schemaApp(t);
  const response = await app.inject({
    method: 'POST',
    url: '/ai-models',
    payload: { providerId: id, kind: 'text', model: 'test-model', params: { temperature: true }, enabled: true },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().error.code, 'REQUEST_ERROR');
  assert.equal(response.json().error.reason, 'PARAMS_INVALID');
  assert.deepEqual(received, [{ temperature: 'true' }]);
});

test('model schema rejects object values, long strings and more than 20 parameters before handler', async t => {
  const { app, received } = await schemaApp(t);
  for (const params of [
    { temperature: {} },
    { temperature: 'x'.repeat(101) },
    Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key${index}`, 0])),
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/ai-models',
      payload: { providerId: id, kind: 'text', model: 'test-model', params, enabled: true },
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  }
  assert.equal(received.length, 0);
});
