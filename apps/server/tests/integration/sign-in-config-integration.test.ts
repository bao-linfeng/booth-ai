import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { getSignInConfig, signInForCredits, updateSignInConfig } from '../../src/modules/credits/account-service.js';

test('sign-in configuration against PostgreSQL: only IANA timezone names are stored, every change is audited', {
  skip: !process.env.CREDIT_TEST_DATABASE_URL, timeout: 60_000,
}, async t => {
  const schema = `sign_in_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: process.env.CREDIT_TEST_DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.CREDIT_TEST_DATABASE_URL, options: `-c search_path=${schema}`, statement_timeout: 10_000 });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
  for (const name of (await readdir(new URL('../../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n)).sort()) {
    await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
  }
  const adminId = randomUUID();
  await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'sign-in-test',ARRAY['ROLE_ADMIN'])", [adminId]);
  const audits = async () => (await pool.query<{ action: string; detail: unknown }>(
    "SELECT action, detail FROM admin_audit_logs WHERE target_type = 'sign_in_config' ORDER BY created_at, id")).rows;
  const initial = await getSignInConfig(pool);

  // 拼写错误、大小写不同的名称，以及 AT TIME ZONE 能接受但符号含义相反的 POSIX 写法，都不能写入
  for (const timezone of ['Asia/Shanghia', 'asia/shanghai', 'UTC+8']) {
    await assert.rejects(updateSignInConfig(pool, { enabled: true, dailyAmount: 30, timezone }, adminId),
      { statusCode: 400, reason: 'INVALID_TIMEZONE' }, timezone);
  }
  assert.deepEqual(await getSignInConfig(pool), initial);
  assert.deepEqual(await audits(), []);

  const updated = { enabled: true, dailyAmount: 30, timezone: 'America/New_York' };
  assert.deepEqual(await updateSignInConfig(pool, updated, adminId), updated);
  assert.deepEqual(await getSignInConfig(pool), updated);
  assert.deepEqual(await audits(), [{ action: 'sign_in_config.update', detail: { before: initial, after: updated } }]);

  const userId = randomUUID();
  await pool.query('INSERT INTO users(id,external_user_id,username) VALUES($1,1,$2)', [userId, 'sign-in-user']);
  assert.deepEqual(await signInForCredits(pool, userId), { amount: 30, balance: 30 });
  const signDate = (await pool.query<{ matches: boolean }>(
    "SELECT sign_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date AS matches FROM sign_in_records WHERE user_id = $1", [userId])).rows[0];
  assert.equal(signDate?.matches, true);
});
