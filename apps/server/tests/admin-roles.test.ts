import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { fetchExternalRoles, fetchExternalUserDetail } from '../src/infra/external-auth.js';
import { createSession, encryptJwt } from '../src/infra/session.js';
import { adminRoutePermissions } from '../src/http/admin/authorization.js';
import { accessSummary, allPermissionCodes, permissionCatalog, permissionGroups, validatePermissionCodes } from '../src/modules/identity/permissions.js';
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
  assert.ok(adminRoutePermissions('GET', '/api/v1/admin/schemes/:code/assets/:assetId/download')?.includes('assets-masks.read'));
  assert.equal(adminRoutePermissions('PUT', '/api/v1/admin/roles/:id/permissions')?.[0], 'roles.write');
  assert.equal(adminRoutePermissions('GET', '/api/v1/admin/unregistered'), null);
});

test('page grants and business actions are independent and enforce their real dependencies', () => {
  assert.ok(!accessSummary(['searches.read']).routeNames.includes('AiSelectionAnalytics'));
  assert.deepEqual(accessSummary(['assets-drawings.read']).routeNames, ['Profile', 'AssetsVenueMaterials']);
  assert.ok(!accessSummary(['dashboard.read']).routeNames.includes('Workspace'));
  assert.equal(accessSummary(['workspace.read']).homePath, '/dashboard/workspace');
  assert.throws(() => validatePermissionCodes(['assets-masks.read', 'assets-masks.preview', 'schemes.read']), { statusCode: 400 });
  assert.throws(() => validatePermissionCodes(['prompts.read', 'prompts.update', 'schemes.read']), { statusCode: 400 });
  assert.throws(() => validatePermissionCodes(['credits.sign_in_config']), { statusCode: 400 });
  assert.deepEqual(validatePermissionCodes(['credits.sign_in_config', 'credits.read', 'users.read']), ['credits.read', 'credits.sign_in_config', 'users.read']);
  assert.equal(new Set(allPermissionCodes).size, allPermissionCodes.length);
  validatePermissionCodes(allPermissionCodes);
  for (const [method, route, expected] of [
    ['POST', '/credits/recharge', 'credits.recharge'],
    ['PUT', '/credits/sign-in-config', 'credits.sign_in_config'],
    ['GET', '/credits/sign-in-config', 'credits.read'],
    ['HEAD', '/credits/sign-in-config', 'credits.read'],
    ['GET', '/scheme-searches/:id', 'searches.detail'],
    ['GET', '/scheme-searches/statistics', 'search-analytics.read'],
    ['POST', '/schemes/:code/unpublish', 'schemes.unpublish'],
    ['POST', '/schemes/:code/bill-of-materials/imports/:importId/commit', 'bom.import'],
    ['DELETE', '/schemes/:code/bill-of-materials/items/:itemId', 'bom.delete-item'],
    ['DELETE', '/schemes/:code/bill-of-materials', 'bom.delete'],
    ['PUT', '/projects/:projectId/assignee', 'projects.assign'],
    ['POST', '/projects/:projectId/follow-ups', 'projects.follow-up'],
    ['PUT', '/projects/:projectId/scheme', 'projects.link-scheme'],
    ['PUT', '/projects/:projectId/quotation', 'projects.quotation'],
    ['GET', '/projects/:projectId/quotation/download', 'projects.quotation-download'],
    ['GET', '/projects/:projectId/assets/:versionId/download', 'projects.asset-download'],
    ['POST', '/project-notifications/read-all', 'notifications.mark-all-read'],
    ['POST', '/project-notifications/:id/read', 'notifications.mark-read'],
    ['POST', '/dictionaries/:id/items', 'dictionaries.item-create'],
    ['DELETE', '/dictionaries/:id/items/:itemId', 'dictionaries.item-delete'],
    ['POST', '/ai-providers/probe', 'ai-models.discover'],
    ['POST', '/ai-providers/:id/catalog/refresh', 'ai-models.discover'],
    ['POST', '/ai-models', 'ai-models.model-create'],
    ['PUT', '/ai-model-assignments/:purpose', 'ai-models.assign'],
  ]) assert.deepEqual(adminRoutePermissions(method!, `/api/v1/admin${route}`), [expected], `${method} ${route}`);
});

test('action-only grants cannot mutate other operations, PATCH fields or other asset types', async t => {
  const actorId = '00000000-0000-4000-8000-000000000001';
  const assetId = '00000000-0000-4000-8000-000000000002';
  let permissions: string[] = ['prompts.read', 'prompts.enable', 'schemes.read'];
  let assetType = 'rendering';
  const pool = { query: async (sql: string) => {
    if (sql.includes('session_version')) return { rows: [{ enabled: true, roles: ['ROLE_TEST'], sessionVersion: 1 }] };
    if (sql.includes('unnest(permission_codes)')) return { rows: permissions.map(code => ({ code })) };
    if (sql.includes('sa.id = $2')) return { rows: [{ id: assetId, type: assetType, schemeCode: 'TEST', revision: 1,
      createdAt: new Date(), updatedAt: new Date(), versionId: assetId, versionAssetId: assetId, versionObjectKey: 'asset',
      versionOriginalFilename: 'asset.png', versionMimeType: 'image/png', versionByteSize: 10, versionChecksum: 'hash', versionCreatedAt: new Date() }] };
    if (sql.includes('FROM scheme_baseline_assets')) return { rows: sql.includes('count(*)') ? [{ total: '0' }] : [] };
    throw new Error('Unauthorized request reached a business query');
  } } as unknown as pg.Pool;
  const values = new Map<string, string>();
  const redis = { get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value); return 'OK'; }, del: async (key: string) => Number(values.delete(key)) } as unknown as Redis;
  const token = await createSession(redis, { site: 'admin', localId: actorId, externalUserId: 1, username: 'test', sessionVersion: 1,
    externalJwtCiphertext: encryptJwt('jwt', config.sessionSecret), loginSource: 'password' }, 3600, Math.floor(Date.now() / 1000) + 3600);
  const app = await buildApp(config, healthy, { pool, redis, storage: { signDownload: async () => '/preview' } } as never);
  t.after(() => app.close());
  const headers = { authorization: `Bearer ${token}` };
  for (const payload of [{ body: 'changed', expectedRevision: 1 }, { enabled: false, expectedRevision: 1 }, { enabled: true, body: 'changed', expectedRevision: 1 }]) {
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/admin/prompt-templates/${assetId}`, headers, payload })).statusCode, 403);
  }
  permissions = ['schemes.read', 'assets-renderings.read', 'assets-renderings.upload'];
  assert.equal((await app.inject({ url: '/api/v1/admin/assets?type=rendering', headers })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/v1/admin/assets?type=mask', headers })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/v1/admin/schemes/TEST/assets?type=mask', headers })).statusCode, 403);
  for (const method of ['PATCH', 'DELETE'] as const) {
    assert.equal((await app.inject({ method, url: `/api/v1/admin/schemes/TEST/assets/${assetId}`, headers, payload: { expectedRevision: 1 } })).statusCode, 403);
  }
  permissions.push('assets-renderings.preview');
  assert.equal((await app.inject({ url: `/api/v1/admin/schemes/TEST/assets/${assetId}/download?disposition=preview`, headers })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/v1/admin/schemes/TEST/assets/${assetId}/download`, headers })).statusCode, 403);
  assetType = 'mask';
  assert.equal((await app.inject({ url: `/api/v1/admin/schemes/TEST/assets/${assetId}/download?disposition=preview`, headers })).statusCode, 403);
  permissions = ['projects.read', 'projects.follow-up'];
  for (const route of ['/assignee', '/scheme', '/quotation']) {
    assert.equal((await app.inject({ method: 'PUT', url: `/api/v1/admin/projects/${assetId}${route}`, headers, payload: {} })).statusCode, 403);
  }
  permissions = ['notifications.read', 'notifications.mark-read'];
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/project-notifications/read-all', headers })).statusCode, 403);
});

test('permission catalog exposes group key and page route names for the authorization tree', () => {
  const schemesRead = permissionCatalog.find(item => item.code === 'schemes.read');
  assert.equal(schemesRead?.groupKey, 'schemes');
  assert.deepEqual(schemesRead?.routes, ['SchemeList', 'SchemeDetail']);
  assert.deepEqual(permissionCatalog.find(item => item.code === 'audit.read')?.routes, []);
  for (const group of permissionGroups) {
    const items = permissionCatalog.filter(item => item.groupKey === group.key);
    assert.equal(items.length, group.actions.length, group.key);
    assert.ok(items.every(item => item.group === group.label && item.routes.join() === group.routes.join()), group.key);
  }
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

for (const roleName of ['ROLE_ADMIN_PRODUCT', 'ROLE_ADMIN']) {
test(`${roleName} API grants, route codes, mutation denials and revocation use current local permissions`, async t => {
  let permissions = ['roles.read'];
  let mutationQueries = 0;
  const pool = { query: async (sql: string) => {
    if (sql.includes('session_version')) return { rows: [{ enabled: true, roles: [roleName], sessionVersion: 1 }] };
    if (sql.includes('unnest(permission_codes)')) {
      assert.ok(sql.includes('FROM admin_roles'));
      return { rows: permissions.map(code => ({ code })) };
    }
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
}

test('all role saves, including ROLE_ADMIN, enforce revisions and audit persisted permission reductions', async () => {
  let name = 'ROLE_ADMIN_PRODUCT';
  let revision = 2;
  let permissions: string[] = [];
  const audits: { before: string[]; after: string[] }[] = [];
  const statements: string[] = [];
  const client = { query: async (sql: string, params?: unknown[]) => {
    statements.push(sql);
    if (sql.includes('FOR UPDATE')) return { rows: [{ name, revision, permissionCodes: [...permissions] }] };
    if (sql.startsWith('UPDATE admin_roles')) {
      permissions = params?.[1] as string[];
      revision++;
    }
    if (sql.includes('INSERT INTO admin_audit_logs')) audits.push(JSON.parse(String(params?.[2])));
    if (sql.includes('unnest(permission_codes)')) {
      assert.deepEqual(params, [['ROLE_ADMIN']]);
      return { rows: permissions.map(code => ({ code })) };
    }
    return { rows: [] };
  }, release() {} };
  const pool = { connect: async () => client, query: client.query } as unknown as pg.Pool;
  const saved = await updateRolePermissions(pool, 4, ['users.read'], 2, 'actor');
  assert.equal(saved.revision, 3);
  assert.ok(statements.some(sql => sql.includes('INSERT INTO admin_audit_logs')));
  assert.equal(statements.at(-1), 'COMMIT');
  await assert.rejects(updateRolePermissions(pool, 4, ['users.read'], 2, 'actor'), { statusCode: 409 });
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(audits.length, 1);
  name = 'ROLE_ADMIN';
  permissions = [...allPermissionCodes];
  const reduced = await updateRolePermissions(pool, 5, ['roles.read'], 3, 'actor');
  assert.deepEqual(reduced, { id: 5, name, permissionCodes: ['roles.read'], revision: 4 });
  assert.equal(statements.at(-1), 'COMMIT');
  assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN']), ['roles.read']);
  assert.deepEqual(audits.at(-1), { before: allPermissionCodes, after: ['roles.read'] });
  await updateRolePermissions(pool, 5, [], 4, 'actor');
  assert.deepEqual(await resolveAdminPermissions(pool, ['ROLE_ADMIN']), []);
});

test('role permission API saves current sign-in grants and rejects obsolete codes without mutation', async t => {
  let permissions = ['credits.read', 'credits.sign_in_config', 'roles.read', 'roles.write', 'users.read'];
  let revision = 8;
  let auditCount = 0;
  let transactions = 0;
  const client = { query: async (sql: string, params?: unknown[]) => {
    if (sql.includes('FOR UPDATE')) return { rows: [{ name: 'ROLE_ADMIN', revision, permissionCodes: permissions }] };
    if (sql.startsWith('UPDATE admin_roles')) {
      permissions = params?.[1] as string[];
      revision++;
    }
    if (sql.includes('INSERT INTO admin_audit_logs')) auditCount++;
    return { rows: [] };
  }, release() {} };
  const pool = { query: async (sql: string) => {
    if (sql.includes('session_version')) return { rows: [{ enabled: true, roles: ['ROLE_ADMIN'], sessionVersion: 1 }] };
    if (sql.includes('unnest(permission_codes)')) return { rows: permissions.map(code => ({ code })) };
    throw new Error('Unexpected query');
  }, connect: async () => { transactions++; return client; } } as unknown as pg.Pool;
  const values = new Map<string, string>();
  const redis = { get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value); return 'OK'; },
    del: async (key: string) => Number(values.delete(key)) } as unknown as Redis;
  const token = await createSession(redis, { site: 'admin', localId: '00000000-0000-4000-8000-000000000001',
    externalUserId: 1, username: 'test', sessionVersion: 1, externalJwtCiphertext: encryptJwt('jwt', config.sessionSecret),
    loginSource: 'password' }, 3600, Math.floor(Date.now() / 1000) + 3600);
  const app = await buildApp(config, healthy, { pool, redis, storage: {} } as never);
  t.after(() => app.close());
  const headers = { authorization: `Bearer ${token}` };
  const url = '/api/v1/admin/roles/5/permissions';
  const obsolete = await app.inject({ method: 'PUT', url, headers,
    payload: { permissionCodes: [...permissions, 'credits.sign-in-config'], expectedRevision: revision } });
  assert.equal(obsolete.statusCode, 400, obsolete.body);
  assert.equal(obsolete.json().error.code, 'VALIDATION_ERROR');
  assert.equal(transactions, 0);
  const saved = await app.inject({ method: 'PUT', url, headers,
    payload: { permissionCodes: [...permissions], expectedRevision: revision } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json().data, { id: 5, name: 'ROLE_ADMIN', permissionCodes: permissions, revision: 9 });
  assert.equal(auditCount, 1);
  const stale = await app.inject({ method: 'PUT', url, headers,
    payload: { permissionCodes: [...permissions], expectedRevision: 8 } });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(auditCount, 1);
});

test('unconfigured roles, including ROLE_ADMIN, have no permissions and cannot inherit external grants', async () => {
  const queriedRoles: string[][] = [];
  const pool = { query: async (sql: string, params: string[][]) => {
    assert.ok(sql.includes('FROM admin_roles'));
    queriedRoles.push(params[0]!);
    return { rows: [] };
  } } as unknown as pg.Pool;
  for (const roles of [[], ['ROLE_ADMIN'], ['ROLE_ADMIN_PRODUCT'], ['ROLE_UNKNOWN']]) {
    assert.deepEqual(await resolveAdminPermissions(pool, roles), []);
  }
  assert.deepEqual(queriedRoles, [['ROLE_ADMIN'], ['ROLE_ADMIN_PRODUCT'], ['ROLE_UNKNOWN']]);
});
