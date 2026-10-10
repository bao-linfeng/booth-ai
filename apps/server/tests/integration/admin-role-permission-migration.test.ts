import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

test(
  'sign-in permission migration preserves grants, deduplicates codes and increments only affected revisions',
  { skip: !process.env.ADMIN_ROLE_TEST_DATABASE_URL },
  async () => {
    const client = new pg.Client({ connectionString: process.env.ADMIN_ROLE_TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE TEMP TABLE admin_roles (
        id bigint PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true,
        permission_codes text[] NOT NULL, revision integer NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT '2026-01-01'
      ) ON COMMIT DROP`);
      const grants = ['roles.read', 'roles.write', 'credits.read', 'users.read'];
      for (const [id, extra, active] of [
        [1, ['credits.sign-in-config'], true],
        [2, ['credits.sign-in-config', 'credits.sign_in_config'], false],
        [3, ['credits.sign_in_config'], true],
        [4, [], true],
      ] as const) {
        await client.query('INSERT INTO admin_roles (id,name,active,permission_codes,revision) VALUES ($1,$2,$3,$4,7)', [
          id,
          `ROLE_TEST_${id}`,
          active,
          [...grants, ...extra],
        ]);
      }
      const before = (await client.query('SELECT * FROM admin_roles ORDER BY id')).rows;
      const sql = await readFile(new URL('../../migrations/070_sign_in_permission_code.sql', import.meta.url), 'utf8');
      await client.query(sql);
      const after = (await client.query('SELECT * FROM admin_roles ORDER BY id')).rows;
      for (const index of [0, 1]) {
        assert.deepEqual(after[index].permission_codes, [...grants, 'credits.sign_in_config'].sort());
        assert.equal(after[index].revision, 8);
        assert.equal(after[index].active, before[index].active);
        assert.equal(after[index].name, before[index].name);
        assert.ok(after[index].updated_at > before[index].updated_at);
      }
      assert.deepEqual(after.slice(2), before.slice(2));
      await client.query(sql);
      assert.deepEqual((await client.query('SELECT * FROM admin_roles ORDER BY id')).rows, after);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  },
);
