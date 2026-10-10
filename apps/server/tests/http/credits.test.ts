import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { getCreditBalance, getSignInConfig, signInForCredits, updateSignInConfig } from '../../src/modules/credits/account-service.js';
import { getUserCreditBalance, listCreditTransactions, rechargeCredits } from '../../src/modules/credits/management-service.js';

test('sign-in awards ten credits once, relying on the unique sign-in record', async () => {
  let balance = 0;
  const pool = { query: async (sql: string, args: unknown[]) => {
    if (sql.includes('FROM sign_in_config')) return { rows: [] };
    if (sql.includes('INSERT INTO sign_in_records')) {
      assert.deepEqual(args, ['user-id', 'Asia/Shanghai', 10]);
      assert.match(sql, /\(CURRENT_TIMESTAMP AT TIME ZONE \$2\)::date/);
      assert.match(sql, /SELECT user_id, 'sign_in', \$3 FROM signed/);
      assert.match(sql, /ON CONFLICT \(user_id, sign_date\) DO NOTHING/);
      if (balance) return { rows: [] };
      balance = 10;
      return { rows: [{ amount: 10 }] };
    }
    assert.deepEqual(args, ['user-id']);
    return { rows: balance ? [{ balance }] : [] };
  } } as unknown as pg.Pool;
  assert.equal(await getCreditBalance(pool, 'user-id'), 0);
  assert.deepEqual(await signInForCredits(pool, 'user-id'), { amount: 10, balance: 10 });
  await assert.rejects(signInForCredits(pool, 'user-id'), { statusCode: 409, reason: 'ALREADY_SIGNED_IN' });
});

test('sign-in configuration maps database fields and defaults when the singleton row is missing', async () => {
  const pool = { query: async (sql: string) => {
    assert.equal(sql, 'SELECT enabled, daily_amount, timezone FROM sign_in_config WHERE id = TRUE');
    return { rows: [{ enabled: false, daily_amount: 25, timezone: 'UTC' }] };
  } } as unknown as pg.Pool;
  assert.deepEqual(await getSignInConfig(pool), { enabled: false, dailyAmount: 25, timezone: 'UTC' });
  const emptyPool = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  assert.deepEqual(await getSignInConfig(emptyPool), { enabled: true, dailyAmount: 10, timezone: 'Asia/Shanghai' });
});

test('disabled sign-in rewards do not write sign-in records or credits', async () => {
  const pool = { query: async (sql: string) => {
    assert.match(sql, /FROM sign_in_config/);
    return { rows: [{ enabled: false, daily_amount: 25, timezone: 'UTC' }] };
  } } as unknown as pg.Pool;
  await assert.rejects(signInForCredits(pool, 'user-id'), { statusCode: 403, reason: 'SIGN_IN_DISABLED' });
});

test('sign-in uses the configured timezone and daily credit amount', async () => {
  const pool = { query: async (sql: string, args: unknown[]) => {
    if (sql.includes('FROM sign_in_config')) {
      return { rows: [{ enabled: true, daily_amount: 25, timezone: 'America/New_York' }] };
    }
    if (sql.includes('INSERT INTO sign_in_records')) {
      assert.deepEqual(args, ['user-id', 'America/New_York', 25]);
      assert.match(sql, /\(CURRENT_TIMESTAMP AT TIME ZONE \$2\)::date/);
      assert.match(sql, /SELECT user_id, 'sign_in', \$3 FROM signed/);
      return { rows: [{ amount: 25 }] };
    }
    assert.deepEqual(args, ['user-id']);
    return { rows: [{ balance: 100 }] };
  } } as unknown as pg.Pool;
  assert.deepEqual(await signInForCredits(pool, 'user-id'), { amount: 25, balance: 100 });
});

test('sign-in configuration rejects unknown timezones before writing and audits accepted changes in one transaction', async () => {
  const statements: string[] = [];
  const run = async (sql: string, args: unknown[]) => {
    statements.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
    if (sql.includes('pg_timezone_names')) return { rows: args[0] === 'Asia/Shanghai' ? [{ '?column?': 1 }] : [] };
    if (sql.includes('FOR UPDATE')) return { rows: [{ enabled: true, dailyAmount: 10, timezone: 'UTC' }] };
    if (sql.includes('INSERT INTO sign_in_config')) {
      assert.deepEqual(args, [false, 25, 'Asia/Shanghai']);
      return { rows: [{ enabled: false, dailyAmount: 25, timezone: 'Asia/Shanghai' }] };
    }
    if (sql.includes('INSERT INTO admin_audit_logs')) {
      assert.deepEqual(args.slice(0, 4), ['admin-id', 'sign_in_config.update', 'sign_in_config', 'default']);
      assert.deepEqual(JSON.parse(args[4] as string), {
        before: { enabled: true, dailyAmount: 10, timezone: 'UTC' }, after: { enabled: false, dailyAmount: 25, timezone: 'Asia/Shanghai' },
      });
    }
    return { rows: [] };
  };
  let connections = 0;
  const pool = { query: run, connect: async () => { connections++; return { query: run, release: () => {} }; } } as unknown as pg.Pool;

  await assert.rejects(updateSignInConfig(pool, { enabled: true, dailyAmount: 10, timezone: 'Asia/Shanghia' }, 'admin-id'),
    { statusCode: 400, reason: 'INVALID_TIMEZONE' });
  assert.equal(connections, 0);
  assert.deepEqual(statements, ['SELECT 1']);

  statements.length = 0;
  assert.deepEqual(await updateSignInConfig(pool, { enabled: false, dailyAmount: 25, timezone: 'Asia/Shanghai' }, 'admin-id'),
    { enabled: false, dailyAmount: 25, timezone: 'Asia/Shanghai' });
  assert.deepEqual(statements, ['SELECT 1', 'BEGIN', 'SELECT enabled,', 'INSERT INTO', 'INSERT INTO', 'COMMIT']);
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
  queries.length = 0;
  await listCreditTransactions(pool, { page: 1, pageSize: 5, jobId: 'job-id' });
  assert.match(queries[0]?.sql ?? '', /\(ct\.theme_job_id=\$1 OR ct\.artwork_job_id=\$1\)/);
  assert.deepEqual(queries[0]?.args, ['job-id', 5, 0]);
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
    ['GET', '/api/v1/admin/credits/sign-in-config'], ['PUT', '/api/v1/admin/credits/sign-in-config'],
  ] as const) {
    const response = await app.inject({ method, url, headers: { authorization: 'Bearer invalid' },
      ...(url.endsWith('/recharge') ? { payload: { userId: '00000000-0000-0000-0000-000000000001', amount: 10, requestKey: 'request' } } : {}),
      ...(method === 'PUT' ? { payload: { enabled: true, dailyAmount: 10, timezone: 'Asia/Shanghai' } } : {}) });
    assert.equal(response.statusCode, 401, `${method} ${url}: ${response.body}`);
  }
});
