import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { loadConfig } from '../../src/config.js';
import type { Redis } from 'ioredis';
import { getSession } from '../../src/infra/session.js';
import { loginAdmin } from '../../src/modules/identity/admin-service.js';
import {
  getAdminRole,
  listAdminRoles,
  resolveAdminPermissions,
  syncAdminRoles,
  updateRolePermissions,
} from '../../src/modules/identity/roles.js';
import { allPermissionCodes, validatePermissionCodes } from '../../src/modules/identity/permissions.js';
import { assertProjectAdmin } from '../../src/modules/projects/admin-service.js';
import { configuredAssignee } from '../../src/modules/projects/assignment.js';
import { projectTestPool } from '../helpers/project-fixtures.js';

// 061 只授予编写时已有的权限；之后新增的权限码由追加迁移补授给 ROLE_ADMIN（如 072、075、082、084）。
// 新增权限码时必须追加补授迁移，否则下方“执行全部迁移后 ROLE_ADMIN 拥有全部权限”的断言会失败。
const introducedBy075 = ['customer-service.read', 'customer-service.reply', 'customer-service.supervise', 'customer-service.settings'];
const introducedBy082 = ['assets-artworks.update'];
const introducedBy084 = ['assets-drawings.update'];
const introducedAfter072 = [...introducedBy075, ...introducedBy082, ...introducedBy084];
const introducedAfter061 = ['credits.sign_in_config', ...introducedAfter072];
const grantedBy061 = allPermissionCodes.filter(code => !introducedAfter061.includes(code));
const grantedBy072 = allPermissionCodes.filter(code => !introducedAfter072.includes(code));

test(
  '060 seeds the original grants, 061 migrates them to page actions and 072 grants later permissions without changing the role ID',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL },
  async t => {
    for (const existingId of [undefined, 5, 42]) {
      await t.test(existingId === undefined ? 'first installation' : `existing role ${existingId}`, async t => {
        const schema = `roles_migration_${randomUUID().replaceAll('-', '')}`;
        const adminPool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL });
        await adminPool.query(`CREATE SCHEMA ${schema}`);
        const pool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
        t.after(async () => {
          await pool.end();
          await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
          await adminPool.end();
        });
        for (const file of ['001_foundation.sql', '002_auth.sql', '051_account_session_versions.sql', '059_admin_role_permissions.sql']) {
          await pool.query(await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
        }
        if (existingId !== undefined) {
          await pool.query("INSERT INTO admin_roles(id,name,permission_codes,revision) VALUES($1,'ROLE_ADMIN',ARRAY['users.read'],7)", [
            existingId,
          ]);
        }
        await pool.query(await readFile(new URL('../../migrations/060_editable_admin_role.sql', import.meta.url), 'utf8'));
        const role = await getAdminRole(pool, existingId ?? 5);
        assert.equal(role.name, 'ROLE_ADMIN');
        assert.equal(role.permissionCodes.length, 35);
        assert.equal(role.revision, existingId === undefined ? 0 : 8);
        await pool.query(await readFile(new URL('../../migrations/061_page_action_permissions.sql', import.meta.url), 'utf8'));
        const migrated = await getAdminRole(pool, existingId ?? 5);
        const historicalQuestionPermissions = ['create', 'delete', 'disable', 'enable', 'read', 'update'].map(
          action => `questions.${action}`,
        );
        assert.deepEqual([...migrated.permissionCodes].sort(), [...grantedBy061, ...historicalQuestionPermissions].sort());
        assert.equal(migrated.revision, role.revision + 1);
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM admin_roles')).rows[0].count, 1);
        assert.deepEqual((await resolveAdminPermissions(pool, ['ROLE_ADMIN'])).sort(), [...grantedBy061].sort());

        const grant = await readFile(new URL('../../migrations/072_grant_sign_in_config_to_admin.sql', import.meta.url), 'utf8');
        await pool.query(grant);
        const granted = await getAdminRole(pool, existingId ?? 5);
        assert.deepEqual([...granted.permissionCodes].sort(), [...grantedBy072, ...historicalQuestionPermissions].sort());
        assert.equal(granted.revision, migrated.revision + 1);
        await pool.query(grant);
        assert.equal((await getAdminRole(pool, existingId ?? 5)).revision, granted.revision);

        // 082 只补授给已能上传平面素材的角色
        await pool.query(
          "INSERT INTO admin_roles(id,name,permission_codes,revision) VALUES(902,'ROLE_VIEWER',ARRAY['assets-artworks.read'],1)",
        );
        const artworkGrant = await readFile(new URL('../../migrations/082_artwork_update_permission.sql', import.meta.url), 'utf8');
        await pool.query(artworkGrant);
        const artworkGranted = await getAdminRole(pool, existingId ?? 5);
        assert.ok(artworkGranted.permissionCodes.includes('assets-artworks.update'));
        assert.equal(artworkGranted.revision, granted.revision + 1);
        assert.deepEqual((await getAdminRole(pool, 902)).permissionCodes, ['assets-artworks.read']);
        await pool.query(artworkGrant);
        assert.equal((await getAdminRole(pool, existingId ?? 5)).revision, artworkGranted.revision);
      });
    }
  },
);

// 路由权限 hook 只检查声明的权限码本身、不复核依赖（见 http/admin/authorization.ts），前提是写入的权限都满足依赖闭包。
// 管理端保存角色时由 validatePermissionCodes 保证；迁移直接写表，由这里断言执行全部迁移后的内置角色仍然满足。
test(
  'after every migration each seeded role grants complete permission dependency closures',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL },
  async t => {
    const pool = await projectTestPool(t);
    const roles = (
      await pool.query<{ name: string; codes: string[] }>('SELECT name, permission_codes AS codes FROM admin_roles ORDER BY name')
    ).rows;
    assert.ok(roles.length > 0);
    for (const role of roles) {
      const known = role.codes.filter(code => allPermissionCodes.includes(code));
      assert.doesNotThrow(() => validatePermissionCodes(known), role.name);
    }
  },
);

test(
  'role synchronization, grants, conflicts, audit and session trigger on real PostgreSQL',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL },
  async t => {
    const pool = await projectTestPool(t);
    const originalFetch = globalThis.fetch;
    t.after(async () => {
      globalThis.fetch = originalFetch;
    });
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.PROJECT_TEST_DATABASE_URL,
      REDIS_URL: 'redis://localhost',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'test',
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
      CORS_ORIGINS: 'http://localhost:5173',
      SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes',
      AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
      EXTERNAL_API_URL: 'https://api.example.test',
    });
    let roles = [
      { id: 5, name: 'ROLE_ADMIN' },
      { id: 4, name: 'ROLE_ADMIN_PRODUCT' },
      { id: 1, name: 'ROLE_ADMIN_USER' },
    ];
    globalThis.fetch = async () => Response.json({ code: '200', success: true, data: roles });
    const actor = randomUUID();
    await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'role-test',ARRAY['ROLE_ADMIN'])", [actor]);
    await pool.query('UPDATE project_assignment_config SET default_assignee_admin_id=$1', [actor]);
    await syncAdminRoles(config, pool, 'jwt');
    const initial = await listAdminRoles(pool);
    assert.equal(initial.length, 3);
    assert.deepEqual((await getAdminRole(pool, 5)).permissionCodes.sort(), [...allPermissionCodes].sort());
    const initialRevision = (await getAdminRole(pool, 5)).revision;
    assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN_PRODUCT']), []);
    await updateRolePermissions(pool, 4, ['schemes.read'], 0, actor);
    await updateRolePermissions(pool, 1, ['users.read'], 0, actor);
    assert.deepEqual((await resolveAdminPermissions(pool, ['ROLE_ADMIN_PRODUCT', 'ROLE_ADMIN_USER'])).sort(), [
      'schemes.read',
      'users.read',
    ]);
    await syncAdminRoles(config, pool, 'jwt');
    assert.equal((await listAdminRoles(pool)).find(role => role.id === 4)?.revision, 1);
    assert.deepEqual((await getAdminRole(pool, 4)).permissionCodes, ['schemes.read']);
    const concurrent = await Promise.allSettled([
      updateRolePermissions(pool, 4, ['schemes.read', 'schemes.create'], 1, actor),
      updateRolePermissions(pool, 4, ['schemes.read', 'schemes.update'], 1, actor),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = concurrent.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && rejected.reason.statusCode === 409);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM admin_audit_logs')).rows[0].count, 3);
    const reduced = await updateRolePermissions(pool, 5, ['roles.read', 'roles.write'], initialRevision, actor);
    assert.equal(reduced.revision, initialRevision + 1);
    assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN']), ['roles.read', 'roles.write']);
    await syncAdminRoles(config, pool, 'jwt');
    assert.deepEqual((await getAdminRole(pool, 5)).permissionCodes, ['roles.read', 'roles.write']);
    assert.equal((await getAdminRole(pool, 5)).revision, initialRevision + 1);
    await assert.rejects(assertProjectAdmin(pool, actor), { statusCode: 403 });
    const client = await pool.connect();
    try {
      assert.deepEqual(await configuredAssignee(client), { assigneeAdminId: null, poolReason: 'permission_revoked' });
      const adminConcurrent = await Promise.allSettled([
        updateRolePermissions(pool, 5, ['roles.read', 'roles.write', 'projects.read', 'projects.follow-up'], initialRevision + 1, actor),
        updateRolePermissions(pool, 5, ['roles.read'], initialRevision + 1, actor),
      ]);
      assert.equal(adminConcurrent.filter(result => result.status === 'fulfilled').length, 1);
      const conflict = adminConcurrent.find(result => result.status === 'rejected');
      assert.ok(conflict?.status === 'rejected' && conflict.reason.statusCode === 409);
      const winner = await getAdminRole(pool, 5);
      const audit = (await pool.query("SELECT detail,admin_id FROM admin_audit_logs WHERE target_id='5' ORDER BY created_at,id")).rows;
      assert.equal(audit.length, 2);
      assert.ok(audit.every(row => row.admin_id === actor));
      assert.deepEqual(audit[0].detail, { before: [...allPermissionCodes].sort(), after: ['roles.read', 'roles.write'] });
      assert.deepEqual(audit[1].detail, { before: ['roles.read', 'roles.write'], after: winner.permissionCodes });
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM admin_audit_logs')).rows[0].count, 5);
      await updateRolePermissions(pool, 5, ['projects.read', 'projects.follow-up'], initialRevision + 2, actor);
      await assertProjectAdmin(pool, actor);
      await assert.rejects(assertProjectAdmin(pool, actor, 'projects.assign'), { statusCode: 403 });
      await assert.rejects(assertProjectAdmin(pool, actor, 'projects.quotation'), { statusCode: 403 });
      assert.deepEqual(await configuredAssignee(client), { assigneeAdminId: actor, poolReason: null });
      await updateRolePermissions(pool, 5, [], initialRevision + 3, actor);
      await syncAdminRoles(config, pool, 'jwt');
      assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN']), []);
      assert.deepEqual((await getAdminRole(pool, 5)).permissionCodes, []);
      await assert.rejects(assertProjectAdmin(pool, actor), { statusCode: 403 });
      assert.deepEqual(await configuredAssignee(client), { assigneeAdminId: null, poolReason: 'permission_revoked' });
    } finally {
      client.release();
    }
    globalThis.fetch = async () => Response.json({ code: '500', success: false });
    await assert.rejects(syncAdminRoles(config, pool, 'jwt'), { statusCode: 502 });
    assert.equal((await getAdminRole(pool, 4)).revision, 2);
    globalThis.fetch = async () => Response.json({ code: '200', success: true, data: roles });
    roles = [
      { id: 5, name: 'ROLE_ADMIN' },
      { id: 4, name: 'ROLE_RENAMED' },
    ];
    await syncAdminRoles(config, pool, 'jwt');
    assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN_PRODUCT', 'ROLE_ADMIN_USER', 'ROLE_RENAMED']), []);
    await assert.rejects(getAdminRole(pool, 1), { statusCode: 404 });
    roles.push({ id: 1, name: 'ROLE_ADMIN_USER' });
    await syncAdminRoles(config, pool, 'jwt');
    assert.deepEqual((await getAdminRole(pool, 1)).permissionCodes, []);
    await pool.query("UPDATE admins SET roles=ARRAY['ROLE_RENAMED'] WHERE id=$1", [actor]);
    await pool.query("UPDATE admins SET roles=ARRAY['ROLE_ADMIN_USER'] WHERE id=$1", [actor]);
    assert.equal((await pool.query('SELECT session_version FROM admins WHERE id=$1', [actor])).rows[0].session_version, 3);
  },
);

test(
  '061 preserves reduced and empty roles and expands only previously granted operations',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL },
  async t => {
    const schema = `roles_actions_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    for (const file of ['001_foundation.sql', '002_auth.sql', '051_account_session_versions.sql', '059_admin_role_permissions.sql']) {
      await pool.query(await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
    }
    await pool.query(`INSERT INTO admin_roles(id,name,permission_codes) VALUES
      (5,'ROLE_ADMIN',ARRAY['roles.read']),
      (6,'EMPTY','{}'),
      (7,'ASSET_READER',ARRAY['schemes.read','assets.read']),
      (8,'PROJECT_READER',ARRAY['projects.read'])`);
    const migration = await readFile(new URL('../../migrations/061_page_action_permissions.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    assert.deepEqual((await getAdminRole(pool, 5)).permissionCodes, ['roles.read']);
    assert.deepEqual((await getAdminRole(pool, 6)).permissionCodes, []);
    assert.equal((await getAdminRole(pool, 6)).revision, 0);
    const assets = await getAdminRole(pool, 7);
    assert.ok(assets.permissionCodes.includes('assets-drawings.read'));
    assert.ok(!assets.permissionCodes.some(code => /\.(upload|replace|delete|download|preview)$/.test(code)));
    assert.deepEqual((await getAdminRole(pool, 8)).permissionCodes, [
      'projects.asset-download',
      'projects.quotation-download',
      'projects.read',
    ]);
    await pool.query(migration);
    assert.equal((await getAdminRole(pool, 7)).revision, assets.revision);
  },
);

test(
  'admin login syncs the role list once for role viewers, keeps the session local and survives role sync failures',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL },
  async t => {
    const pool = await projectTestPool(t);
    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.PROJECT_TEST_DATABASE_URL,
      REDIS_URL: 'redis://localhost',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'test',
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
      CORS_ORIGINS: 'http://localhost:5173',
      SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes',
      AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
      EXTERNAL_API_URL: 'https://api.example.test',
    });
    await pool.query("INSERT INTO admin_roles(id,name,permission_codes) VALUES(78,'ROLE_VIEWER',ARRAY['users.read'])");
    const values = new Map<string, string>();
    const redis = {
      set: async (key: string, value: string) => {
        values.set(key, value);
        return 'OK';
      },
      get: async (key: string) => values.get(key) ?? null,
      del: async (key: string) => Number(values.delete(key)),
    } as unknown as Redis;
    // 灵通 JWT 只剩 60 秒：本地会话仍按 SESSION_TTL_SECONDS 计算
    const jwt = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.sig`;
    let account = { id: 9001, username: 'role-admin', roles: ['ROLE_ADMIN'] };
    let roleList: () => Response = () =>
      Response.json({
        code: '200',
        success: true,
        data: [
          { id: 5, name: 'ROLE_ADMIN' },
          { id: 78, name: 'ROLE_VIEWER' },
          { id: 79, name: 'ROLE_FROM_LINGTONG' },
        ],
      });
    const roleCalls: string[] = [];
    globalThis.fetch = async input => {
      const url = String(input);
      if (url.includes('/api/auth/login'))
        return Response.json({ success: true, code: '200', data: { JWT: jwt, data: { id: account.id, username: account.username } } });
      if (url.includes('/api/user/username/'))
        return Response.json({
          success: true,
          data: { id: account.id, username: account.username, enabled: true, roles: account.roles.map(name => ({ name })) },
        });
      if (url.endsWith('/api/role/all')) {
        roleCalls.push(url);
        return roleList();
      }
      throw new Error(`Unexpected fetch ${url}`);
    };

    const before = Math.floor(Date.now() / 1000);
    const login = await loginAdmin(config, pool, redis, account.username, 'secret');
    assert.equal(roleCalls.length, 1);
    assert.ok((await listAdminRoles(pool)).some(role => role.name === 'ROLE_FROM_LINGTONG'));
    assert.ok(login.expiresAt >= before + config.sessionTtlSeconds);
    const session = await getSession(redis, login.accessToken, 'admin');
    assert.equal(session?.expiresAt, login.expiresAt);
    assert.ok(![...values.values()].some(value => value.includes(jwt)), 'admin session does not keep the external JWT');

    // 上游角色列表失败不影响登录，已同步的角色保持不变
    roleList = () => Response.json({ code: '500', success: false });
    await loginAdmin(config, pool, redis, account.username, 'secret');
    assert.equal(roleCalls.length, 2);
    assert.ok((await listAdminRoles(pool)).some(role => role.name === 'ROLE_FROM_LINGTONG'));

    // 没有 roles.read 的管理员登录不拉角色列表
    account = { id: 9002, username: 'viewer-admin', roles: ['ROLE_VIEWER'] };
    const viewer = await loginAdmin(config, pool, redis, account.username, 'secret');
    assert.deepEqual(viewer.user.permissions, ['users.read']);
    assert.equal(roleCalls.length, 2);
  },
);
