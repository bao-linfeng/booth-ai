import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { getAdminRole, listAdminRoles, resolveAdminPermissions, updateRolePermissions } from '../src/modules/identity/roles.js';

test('role synchronization, grants, conflicts, audit and session trigger on real PostgreSQL',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL }, async t => {
    const schema = `roles_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    const originalFetch = globalThis.fetch;
    t.after(async () => {
      globalThis.fetch = originalFetch;
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    for (const file of ['001_foundation.sql', '002_auth.sql', '022_audit_log.sql', '051_account_session_versions.sql', '059_admin_role_permissions.sql']) {
      await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    }
    const config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env.PROJECT_TEST_DATABASE_URL, REDIS_URL: 'redis://localhost',
      S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:9000', S3_BUCKET: 'test',
      S3_ACCESS_KEY: 'test', S3_SECRET_KEY: 'test', CORS_ORIGINS: 'http://localhost:5173',
      SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
      EXTERNAL_API_URL: 'https://api.example.test',
    });
    let roles = [{ id: 5, name: 'ROLE_ADMIN' }, { id: 4, name: 'ROLE_ADMIN_PRODUCT' }, { id: 1, name: 'ROLE_ADMIN_USER' }];
    globalThis.fetch = async () => Response.json({ code: '200', success: true, data: roles });
    const actor = randomUUID();
    await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'role-test',ARRAY['ROLE_ADMIN'])", [actor]);
    const initial = await listAdminRoles(config, pool, 'jwt');
    assert.equal(initial.length, 3);
    assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN_PRODUCT']), []);
    await updateRolePermissions(pool, 4, ['schemes.read'], 0, actor);
    await updateRolePermissions(pool, 1, ['users.read'], 0, actor);
    assert.deepEqual((await resolveAdminPermissions(pool, ['ROLE_ADMIN_PRODUCT', 'ROLE_ADMIN_USER'])).sort(), ['schemes.read', 'users.read']);
    assert.equal((await listAdminRoles(config, pool, 'jwt')).find(role => role.id === 4)?.revision, 1);
    assert.deepEqual((await getAdminRole(pool, 4)).permissionCodes, ['schemes.read']);
    const concurrent = await Promise.allSettled([
      updateRolePermissions(pool, 4, ['schemes.read', 'schemes.create'], 1, actor),
      updateRolePermissions(pool, 4, ['schemes.read', 'schemes.update'], 1, actor),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = concurrent.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && rejected.reason.statusCode === 409);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM admin_audit_logs')).rows[0].count, 3);
    await assert.rejects(updateRolePermissions(pool, 5, [], 0, actor), { statusCode: 400 });
    globalThis.fetch = async () => Response.json({ code: '500', success: false });
    await assert.rejects(listAdminRoles(config, pool, 'jwt'), { statusCode: 502 });
    assert.equal((await getAdminRole(pool, 4)).revision, 2);
    globalThis.fetch = async () => Response.json({ code: '200', success: true, data: roles });
    roles = [{ id: 5, name: 'ROLE_ADMIN' }, { id: 4, name: 'ROLE_RENAMED' }];
    await listAdminRoles(config, pool, 'jwt');
    assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN_PRODUCT', 'ROLE_ADMIN_USER', 'ROLE_RENAMED']), []);
    await assert.rejects(getAdminRole(pool, 1), { statusCode: 404 });
    roles.push({ id: 1, name: 'ROLE_ADMIN_USER' });
    await listAdminRoles(config, pool, 'jwt');
    assert.deepEqual((await getAdminRole(pool, 1)).permissionCodes, []);
    await pool.query("UPDATE admins SET roles=ARRAY['ROLE_RENAMED'] WHERE id=$1", [actor]);
    await pool.query("UPDATE admins SET roles=ARRAY['ROLE_ADMIN_USER'] WHERE id=$1", [actor]);
    assert.equal((await pool.query('SELECT session_version FROM admins WHERE id=$1', [actor])).rows[0].session_version, 3);
  });
