import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import { Redis } from 'ioredis';
import pg from 'pg';

/** 在线客服集成测试：在 CS_TEST_DATABASE_URL 中建临时 schema 并执行全部迁移 */
export async function csTestPool(t: TestContext): Promise<pg.Pool> {
  const schema = `cs_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: process.env.CS_TEST_DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.CS_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 20 });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return pool;
}

export function csTestRedis(t: TestContext): Redis {
  const redis = new Redis(process.env.CS_TEST_REDIS_URL!, { maxRetriesPerRequest: 1 });
  t.after(() => redis.disconnect());
  return redis;
}

let external = 1000;

export async function seedUser(pool: pg.Pool, email: string | null = null): Promise<string> {
  external++;
  return (await pool.query<{ id: string }>('INSERT INTO users(external_user_id,username,email) VALUES($1,$2,$3) RETURNING id',
    [external, `user-${external}`, email])).rows[0]!.id;
}

/** 坐席：账号所属角色授予 permissions；默认 read + reply */
export async function seedAdmin(pool: pg.Pool, permissions = ['customer-service.read', 'customer-service.reply'], nickname: string | null = null): Promise<string> {
  external++;
  const role = `ROLE_CS_${external}`;
  await pool.query('INSERT INTO admin_roles(id,name,permission_codes) VALUES($1,$2,$3)', [external, role, permissions]);
  return (await pool.query<{ id: string }>('INSERT INTO admins(external_user_id,username,nickname,roles) VALUES($1,$2,$3,$4) RETURNING id',
    [external, `agent-${external}`, nickname, [role]])).rows[0]!.id;
}

export async function seedScheme(pool: pg.Pool, code: string, publishStatus = 'published'): Promise<void> {
  await pool.query("INSERT INTO schemes(code,name,publish_status,length_mm,width_mm,opening_count) VALUES($1,$2,$3,6000,3000,2)", [code, `方案 ${code}`, publishStatus]);
}

export async function seedProject(pool: pg.Pool, owner: { userId?: string | null; visitorId?: string | null }, assignee: string): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO projects(id,request_no,source_type,customer_user_id,visitor_id,assignee_admin_id,scheme_code,request_snapshot)
    VALUES($1,$2,'quote_request',$3,$4,$5,'S-001',$6)`, [id, `QR-${id.toUpperCase()}`, owner.userId ?? null, owner.visitorId ?? null, assignee, JSON.stringify({
    customerType: 'company', company: 'ACME', contact: { name: 'Buyer', email: 'buyer@example.com' }, materialBudget: 'secret-budget',
    exhibition: { name: 'IFA', countryCode: 'DE', city: 'Berlin', startDate: '2026-11-01', endDate: '2026-11-03' },
  })]);
  return id;
}
