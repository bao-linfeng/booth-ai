import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getCreditBalance, signInForCredits } from '../src/modules/credits/account-service.js';
import { getUserCreditBalance, listCreditTransactions, rechargeCredits } from '../src/modules/credits/management-service.js';

test('sign-in awards ten credits once, relying on the unique sign-in record', async () => {
  let balance = 0;
  const pool = { query: async (sql: string, args: unknown[]) => {
    assert.deepEqual(args, ['user-id']);
    if (sql.includes('INSERT INTO sign_in_records')) {
      assert.match(sql, /ON CONFLICT \(user_id, sign_date\) DO NOTHING/);
      if (balance) return { rows: [] };
      balance = 10;
      return { rows: [{ amount: 10 }] };
    }
    return { rows: balance ? [{ balance }] : [] };
  } } as unknown as pg.Pool;
  assert.equal(await getCreditBalance(pool, 'user-id'), 0);
  assert.deepEqual(await signInForCredits(pool, 'user-id'), { amount: 10, balance: 10 });
  await assert.rejects(signInForCredits(pool, 'user-id'), { statusCode: 409, reason: 'ALREADY_SIGNED_IN' });
});

test('admin credit service validates recharge and filters transactions', async () => {
  const queries: { sql: string; args: unknown[] }[] = [];
  const run = async (sql: string, args: unknown[]) => {
    queries.push({ sql, args });
    if (sql.includes('count(*)')) return { rows: [{ total: '1' }] };
    if (sql.includes('user_credit_balances')) return { rows: [] };
    if (sql.includes('INSERT INTO credit_transactions')) return { rows: [{ id: 'transaction-id' }] };
    if (sql.includes('SELECT') && sql.includes('FROM credit_transactions ct')) return { rows: [{ id: 'transaction-id', userId: 'user-id', amount: 20, note: 'test', operatorId: 'admin-id' }] };
    return { rows: [{ id: 'transaction-id' }] };
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => {} }) } as unknown as pg.Pool;
  const list = await listCreditTransactions(pool, { page: 2, pageSize: 5, userId: 'user-id', kind: 'recharge' });
  assert.equal(list.total, 1);
  assert.deepEqual(queries[0]?.args, ['user-id', 'recharge', 5, 5]);
  assert.deepEqual(queries[1]?.args, ['user-id', 'recharge']);
  assert.equal(await getUserCreditBalance(pool, 'user-id'), 0);
  for (const amount of [0, -1, 1.5, 2147483648]) {
    await assert.rejects(rechargeCredits(pool, { userId: 'user-id', amount, operatorId: 'admin-id', requestKey: 'request' }), { statusCode: 400, reason: 'INVALID_AMOUNT' });
  }
  const result = await rechargeCredits(pool, { userId: 'user-id', amount: 20, operatorId: 'admin-id', note: 'test', requestKey: 'request' });
  assert.equal(result.operatorId, 'admin-id');
  assert.deepEqual(queries.find(q => q.sql.includes('INSERT INTO credit_transactions'))?.args, ['user-id', 20, 'test', 'admin-id', 'request']);
});

test('credit routes require a session; client and admin sessions cannot be exchanged', async t => {
  const config = loadConfig({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
    S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
    S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only', CORS_ORIGINS: 'http://localhost:5173',
    SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test',
  });
  const pool = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  const redis = { get: async () => null };
  const app = await buildApp(config, { database: async () => {}, redis: async () => {}, storage: async () => {} },
    { pool, redis, storage: {} } as unknown as NonNullable<Parameters<typeof buildApp>[2]>);
  t.after(() => app.close());
  for (const [method, url] of [
    ['GET', '/api/v1/client/credits/balance'], ['POST', '/api/v1/client/credits/sign-in'],
    ['GET', '/api/v1/admin/credits'], ['POST', '/api/v1/admin/credits/recharge'],
    ['GET', '/api/v1/admin/credits/users/00000000-0000-0000-0000-000000000001/balance'],
  ] as const) {
    const response = await app.inject({ method, url, headers: { authorization: 'Bearer invalid' },
      ...(url.endsWith('/recharge') ? { payload: { userId: '00000000-0000-0000-0000-000000000001', amount: 10, requestKey: 'request' } } : {}) });
    assert.equal(response.statusCode, 401, `${method} ${url}: ${response.body}`);
  }
});
