import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import pg from 'pg';

export async function projectTestPool(t: TestContext): Promise<pg.Pool> {
  const schema = `projects_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
  for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  return pool;
}
