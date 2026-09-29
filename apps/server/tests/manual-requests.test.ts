import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { emptyRequirement } from '../src/modules/client/selection/domain.js';
import { createManualRequest, normalizeManualRequest, type ManualRequestInput } from '../src/modules/client/manual-requests/service.js';
import { followUpManualRequest, getManualRequest, listManualRequests } from '../src/modules/admin/manual-requests/service.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const input: ManualRequestInput = {
  requestKey: 'request-123456', contactName: ' 张先生 ', contactDetail: '13800138000', originalText: '希望有洽谈区',
  requirement: emptyRequirement(), unresolvedQuestions: ['展位限高？'], schemeContext: { code: 'S-01', differences: [{ field: 'height', requested: '4m', actual: '3m', reason: '限高不同' }], pendingConfirmations: ['现场确认'] },
};

test('manual request validates contact and keeps original selection context', () => {
  assert.equal(normalizeManualRequest(input).contactName, '张先生');
  assert.equal(normalizeManualRequest(input).schemeContext?.differences[0]?.reason, '限高不同');
  assert.throws(() => normalizeManualRequest({ ...input, contactDetail: 'not a contact' }), { statusCode: 400 });
  assert.throws(() => normalizeManualRequest({ ...input, contactName: '   ' }), { statusCode: 400 });
  const contactOnly = normalizeManualRequest({ ...input, originalText: '', unresolvedQuestions: [], schemeContext: undefined });
  assert.equal(contactOnly.contactName, '张先生');
});

test('requestKey retries return same receipt, conflicting content is rejected', async () => {
  let row: { id: string; payloadHash: string; status: string; createdAt: Date } | undefined;
  const pool = { query: async (sql: string, args: unknown[]) => {
    if (sql.includes('FROM schemes')) return { rows: [{ id: 'scheme-id' }] };
    if (sql.includes('FROM manual_requests WHERE request_key')) return { rows: row ? [row] : [] };
    if (sql.includes('INSERT INTO manual_requests')) {
      if (row) return { rows: [] };
      row = { id: 'req-id', payloadHash: args[1] as string, status: 'pending', createdAt: new Date('2026-01-01') };
      assert.equal(args[2], null);
      assert.equal(args[3], '张先生');
      return { rows: [row] };
    }
    return { rows: row ? [row] : [] };
  } } as unknown as pg.Pool;
  const created = await createManualRequest(pool, input, null);
  assert.deepEqual(await createManualRequest(pool, input, null), created);
  await assert.rejects(createManualRequest(pool, { ...input, contactDetail: 'another@example.com' }, null), { statusCode: 409 });
});

test('scheme context requires a visible reviewed scheme', async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  await assert.rejects(createManualRequest(pool, input, null), { statusCode: 400 });
});

test('admin list filters and follow-up updates persisted request', async () => {
  const queries: { sql: string; args: unknown[] }[] = [];
  const pool = { query: async (sql: string, args: unknown[]) => {
    queries.push({ sql, args });
    if (sql.includes('count(*)')) return { rows: [{ total: '1' }] };
    if (sql.includes('UPDATE')) return { rows: [{ id: 'req-id', status: args[1], followUpNote: args[2], followedBy: args[3] }] };
    return { rows: [{ id: 'req-id' }] };
  } } as unknown as pg.Pool;
  const list = await listManualRequests(pool, { page: 2, pageSize: 5, status: 'pending' });
  assert.equal(list.total, 1);
  assert.deepEqual(queries[0]?.args, ['pending', 5, 5]);
  assert.equal((await getManualRequest(pool, 'req-id') as { id: string }).id, 'req-id');
  const updated = await followUpManualRequest(pool, 'req-id', 'admin-id', { status: 'following_up', followUpNote: ' 已电话联系 ' }) as { followUpNote: string };
  assert.equal(updated.followUpNote, '已电话联系');
});

test('anonymous submission is accepted; admin list requires authentication', async t => {
  const config = loadConfig({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
    S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
    S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only', CORS_ORIGINS: 'http://localhost:5173',
    SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test',
  });
  const pool = { query: async (sql: string, args: unknown[]) => {
    if (sql.includes('FROM schemes')) return { rows: [{ id: 'scheme-id' }] };
    if (sql.includes('FROM manual_requests WHERE request_key')) return { rows: [] };
    if (sql.includes('INSERT INTO manual_requests')) {
      assert.equal(args[2], null);
      return { rows: [{ id: 'request-id', payloadHash: args[1], status: 'pending', createdAt: new Date('2026-01-01') }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as pg.Pool;
  const redis = { eval: async () => 1, get: async () => null };
  const app = await buildApp(config, { database: async () => {}, redis: async () => {}, storage: async () => {} },
    { pool, redis, storage: {} } as unknown as NonNullable<Parameters<typeof buildApp>[2]>);
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/v1/client/manual-requests', payload: input });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.id, 'request-id');
  const invalid = await app.inject({ method: 'POST', url: '/api/v1/client/manual-requests', payload: { ...input, contactDetail: 'invalid' } });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await app.inject('/api/v1/admin/manual-requests')).statusCode, 401);
});
