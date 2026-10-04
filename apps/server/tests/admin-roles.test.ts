import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { fetchExternalRoles, fetchExternalUserDetail } from '../src/infra/external-auth.js';
import { createSession, encryptJwt } from '../src/infra/session.js';
import { adminRoutePermissions } from '../src/http/admin/authorization.js';
import { accessSummary, allPermissionCodes, validatePermissionCodes } from '../src/modules/identity/permissions.js';
import { resolveAdminPermissions, updateRolePermissions } from '../src/modules/identity/roles.js';

const config = loadConfig({
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'test', S3_SECRET_KEY: 'test', CORS_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test',
});
const healthy = { database: async () => {}, redis: async () => {}, storage: async () => {} };

test('external role list projects only id/name and rejects errors, duplicates and malformed IDs', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let data: unknown = [{ id: 5, name: 'ROLE_ADMIN', roleEntityPermissions: [{ permission: 'roles.write' }] }];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.example.test/api/role/all');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer upstream-jwt');
    return Response.json({ code: '200', success: true, data });
  };
  assert.deepEqual(await fetchExternalRoles(config, 'upstream-jwt'), [{ id: 5, name: 'ROLE_ADMIN' }]);
  for (const invalid of [[{ id: '5', name: 'ROLE_ADMIN' }], [{ id: 1, name: '' }],
    [{ id: 1, name: 'A' }, { id: 1, name: 'B' }], [{ id: 1, name: 'A' }, { id: 2, name: 'A' }], null]) {
    data = invalid;
    await assert.rejects(fetchExternalRoles(config, 'upstream-jwt'), { statusCode: 502 });
  }
  globalThis.fetch = async () => Response.json({ code: '500', success: false, data: [] });
  await assert.rejects(fetchExternalRoles(config, 'upstream-jwt'), { statusCode: 502 });
  globalThis.fetch = async () => Response.json({ success: true, data: { id: 1, username: 'test', enabled: true,
    roles: [{ name: 'ROLE_ADMIN_PRODUCT', roleEntityPermissions: [{ permission: 'roles.write' }] }, { name: 'ROLE_USER_VIP' }] } });
  const profile = await fetchExternalUserDetail(config, 'test', 'jwt');
  assert.deepEqual(profile.roles, ['ROLE_ADMIN_PRODUCT', 'ROLE_USER_VIP']);
  assert.deepEqual(profile.permissions, []);
});

test('permission catalog rejects unknown and orphan actions; route grants follow local permissions', () => {
  assert.throws(() => validatePermissionCodes(['roles.write']), { statusCode: 400 });
  assert.throws(() => validatePermissionCodes(['unknown.read']), { statusCode: 400 });
  assert.throws(() => validatePermissionCodes(['bom.read']), { statusCode: 400 });
  assert.deepEqual(validatePermissionCodes(['bom.read', 'schemes.read', 'dictionaries.read']), ['bom.read', 'dictionaries.read', 'schemes.read']);
  assert.deepEqual(validatePermissionCodes(['roles.write', 'roles.read', 'roles.read']), ['roles.read', 'roles.write']);
  const summary = accessSummary(['schemes.read', 'schemes.create']);
  assert.ok(summary.routeNames.includes('SchemeCreate'));
  assert.ok(!summary.routeNames.includes('UserRoles'));
  assert.equal(summary.homePath, '/profile');
  assert.equal(adminRoutePermissions('POST', '/api/v1/admin/schemes/:code/publish')?.[0], 'schemes.publish');
  assert.equal(adminRoutePermissions('GET', '/api/v1/admin/schemes/:code/assets/:assetId/download')?.[0], 'assets.download');
  assert.equal(adminRoutePermissions('PUT', '/api/v1/admin/roles/:id/permissions')?.[0], 'roles.write');
  assert.equal(adminRoutePermissions('GET', '/api/v1/admin/unregistered'), null);
});

test('all registered admin business endpoints have an explicit local permission policy', async t => {
  const app = await buildApp(config, healthy, { pool: {}, redis: {}, storage: {} } as never);
  t.after(() => app.close());
  const spec = (await app.inject('/openapi.json')).json<{ paths: Record<string, Record<string, unknown>> }>();
  for (const [url, methods] of Object.entries(spec.paths)) {
    if (!url.startsWith('/api/v1/admin/') || url.includes('/auth/')) continue;
    const route = url.replace(/\{([^}]+)\}/g, ':$1');
    for (const method of Object.keys(methods)) {
      if (method === 'parameters') continue;
      const required = adminRoutePermissions(method.toUpperCase(), route);
      assert.notEqual(required, null, `${method} ${route}`);
      assert.ok(required?.every(code => allPermissionCodes.includes(code)), `${method} ${route}`);
    }
  }
});

test('non-super admin API grants, route codes, mutation denials and revocation use current local permissions', async t => {
  let permissions = ['roles.read'];
  let mutationQueries = 0;
  const pool = { query: async (sql: string) => {
    if (sql.includes('session_version')) return { rows: [{ enabled: true, roles: ['ROLE_ADMIN_PRODUCT'], sessionVersion: 1 }] };
    if (sql.includes('unnest(permission_codes)')) return { rows: permissions.map(code => ({ code })) };
    mutationQueries++;
    throw new Error('Denied requests must not reach business queries');
  } } as unknown as pg.Pool;
  const values = new Map<string, string>();
  const redis = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value); return 'OK'; },
    del: async (key: string) => Number(values.delete(key)),
  } as unknown as Redis;
  const token = await createSession(redis, { site: 'admin', localId: '00000000-0000-4000-8000-000000000001',
    externalUserId: 1, username: 'test', sessionVersion: 1, externalJwtCiphertext: encryptJwt('jwt', config.sessionSecret), loginSource: 'password' }, 3600, Math.floor(Date.now() / 1000) + 3600);
  const app = await buildApp(config, healthy, { pool, redis, storage: {} } as never);
  t.after(() => app.close());
  const headers = { authorization: `Bearer ${token}` };
  const access = await app.inject({ url: '/api/v1/admin/access', headers });
  assert.equal(access.statusCode, 200, access.body);
  assert.deepEqual(access.json().data.permissions, ['roles.read']);
  assert.ok(access.json().data.routeNames.includes('UserRoles'));
  assert.equal((await app.inject({ url: '/api/v1/admin/permissions', headers })).statusCode, 200);
  for (const url of ['/api/v1/admin/users', '/api/v1/admin/schemes', '/api/v1/admin/projects']) {
    assert.equal((await app.inject({ url, headers })).statusCode, 403);
  }
  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/admin/roles/4/permissions', headers,
    payload: { permissionCodes: ['roles.read', 'roles.write'], expectedRevision: 0 } })).statusCode, 403);
  assert.equal(mutationQueries, 0);
  permissions = ['users.read'];
  assert.equal((await app.inject({ url: '/api/v1/admin/permissions', headers })).statusCode, 403);
  const changed = (await app.inject({ url: '/api/v1/admin/access', headers })).json().data;
  assert.deepEqual(changed.permissions, ['users.read']);
  assert.ok(!changed.routeNames.includes('UserRoles'));
  permissions = [];
  assert.equal((await app.inject({ url: '/api/v1/admin/access', headers })).statusCode, 403);
  assert.equal(values.size, 0);
});

test('built-in role is immutable; role saves enforce revisions and audit in one transaction', async () => {
  let name = 'ROLE_ADMIN_PRODUCT';
  let revision = 2;
  const statements: string[] = [];
  const client = { query: async (sql: string) => {
    statements.push(sql);
    if (sql.includes('FOR UPDATE')) return { rows: [{ name, revision, permissionCodes: [] }] };
    return { rows: [] };
  }, release() {} };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  const saved = await updateRolePermissions(pool, 4, ['users.read'], 2, 'actor');
  assert.equal(saved.revision, 3);
  assert.ok(statements.some(sql => sql.includes('INSERT INTO admin_audit_logs')));
  assert.equal(statements.at(-1), 'COMMIT');
  revision = 3;
  await assert.rejects(updateRolePermissions(pool, 4, ['users.read'], 2, 'actor'), { statusCode: 409 });
  assert.equal(statements.at(-1), 'ROLLBACK');
  name = 'ROLE_ADMIN';
  await assert.rejects(updateRolePermissions(pool, 5, [], 3, 'actor'), { statusCode: 400 });
  assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN']), allPermissionCodes);
});
