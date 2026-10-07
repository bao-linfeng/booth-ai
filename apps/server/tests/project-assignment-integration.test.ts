import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Redis } from 'ioredis';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { projectTestPool } from './project-fixtures.js';
import { getAssignmentConfig } from '../src/modules/projects/assignment.js';
import { assignProject, followUpProject, saveAssignmentConfig } from '../src/modules/projects/admin-service.js';
import { createManualProject } from '../src/modules/projects/service.js';
import { getProject } from '../src/modules/projects/repository.js';
import { emptyRequirement } from '../src/modules/selection/domain.js';
import type { ManualInput } from '../src/modules/projects/domain.js';
import { adminRoutePermissions } from '../src/http/admin/authorization.js';
import type { createStorage } from '../src/infra/storage.js';

test('assignment configuration route permissions are explicit', () => {
  assert.deepEqual(adminRoutePermissions('GET', '/api/v1/admin/project-assignment-config'), ['projects.read']);
  assert.deepEqual(adminRoutePermissions('PUT', '/api/v1/admin/project-assignment-config'), ['projects.assign']);
});

test('explicit assignment: pause, restore, immutable owners, conflicts, permissions and audit', {
  skip: !process.env.PROJECT_TEST_DATABASE_URL,
}, async t => {
  const pool = await projectTestPool(t);
  const actor = randomUUID(); const target = randomUUID(); const user = randomUUID(); const reader = randomUUID();
  await pool.query(`INSERT INTO admin_roles(id,name,permission_codes) VALUES
    (100,'FOLLOWER',ARRAY['projects.read','projects.follow-up']), (101,'READER',ARRAY['projects.read'])`);
  for (const [index, [id, role]] of [[actor, 'ROLE_ADMIN'], [target, 'FOLLOWER'], [reader, 'READER']].entries()) {
    await pool.query('INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,$2,$1::uuid::text,$3)', [id, index + 1, [role]]);
  }
  await pool.query('INSERT INTO users(id,external_user_id,username) VALUES($1,1,$1::uuid::text)', [user]);
  const input: ManualInput = { requestKey: randomUUID(), entryPoint: 'matching_results', originalDescription: '需人工确认', confirmedRequirements: emptyRequirement(),
    exhibition: { name: '测试展会', countryCode: 'CN', city: '上海', startDate: '2026-11-20', endDate: '2026-11-22' },
    scopeCodes: ['materials'], materialBudget: { currency: 'CNY', amount: '30000' }, customerType: 'individual', contact: { name: '客户', email: 'test@example.com' } };
  assert.equal((await getAssignmentConfig(pool)).status, 'unconfigured');
  await assert.rejects(createManualProject(pool, user, input), { reason: 'ASSIGNMENT_UNAVAILABLE', statusCode: 503 });
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM projects')).rows[0].count, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM project_operations')).rows[0].count, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM project_notification_outbox')).rows[0].count, 0);
  await assert.rejects(saveAssignmentConfig(pool, reader, { defaultAssigneeAdminId: target, expectedRevision: 0 }), { statusCode: 403 });
  await assert.rejects(saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: reader, expectedRevision: 0 }), { reason: 'INVALID_ASSIGNEE' });
  const config = await saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: target, expectedRevision: 0 });
  assert.equal(config.status, 'active'); assert.equal(config.revision, 1);
  const accepted = await createManualProject(pool, user, input);
  const id = String(accepted.receipt.projectId);
  assert.equal((await getProject(pool, id)).assigneeAdminId, target);
  await pool.query('UPDATE admins SET enabled=false WHERE id=$1', [target]);
  assert.equal((await getAssignmentConfig(pool)).status, 'disabled');
  const retained = await getProject(pool, id);
  assert.equal(retained.assigneeAdminId, target); assert.equal(retained.assigneeStatus, 'disabled'); assert.equal(retained.revision, 1);
  assert.deepEqual((await createManualProject(pool, user, input)).receipt, accepted.receipt);
  await assert.rejects(createManualProject(pool, user, { ...input, requestKey: randomUUID() }), { reason: 'ASSIGNMENT_UNAVAILABLE' });
  await assert.rejects(followUpProject(pool, id, target, { requestKey: randomUUID(), expectedRevision: 1, contactMethod: 'email', contactedAt: new Date().toISOString(), content: '停用后跟进' }), { statusCode: 403 });
  await assignProject(pool, id, actor, { requestKey: randomUUID(), expectedRevision: 1, assigneeAdminId: actor, reason: '承接人停用，人工改派' });
  assert.equal((await getProject(pool, id)).assigneeStatus, 'active');
  assert.equal((await getAssignmentConfig(pool)).defaultAssigneeAdminId, target);
  await pool.query('UPDATE admins SET enabled=true WHERE id=$1', [target]);
  await pool.query("UPDATE admin_roles SET permission_codes=ARRAY['projects.read'] WHERE name='FOLLOWER'");
  assert.equal((await getAssignmentConfig(pool)).status, 'permission_revoked');
  await assert.rejects(createManualProject(pool, user, { ...input, requestKey: randomUUID() }), { reason: 'ASSIGNMENT_UNAVAILABLE' });
  await assert.rejects(saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: target, expectedRevision: 1 }), { reason: 'INVALID_ASSIGNEE' });
  await pool.query("UPDATE admin_roles SET permission_codes=ARRAY['projects.follow-up'] WHERE name='FOLLOWER'");
  assert.equal((await getAssignmentConfig(pool)).status, 'permission_revoked');
  await assert.rejects(followUpProject(pool, id, target, { requestKey: randomUUID(), expectedRevision: 2, contactMethod: 'email', contactedAt: new Date().toISOString(), content: '失去项目查看权限后跟进' }), { statusCode: 403 });
  await pool.query("UPDATE admin_roles SET permission_codes=ARRAY['projects.read','projects.follow-up'] WHERE name='FOLLOWER'");
  const resumed = await createManualProject(pool, user, { ...input, requestKey: randomUUID() });
  const resumedId = String(resumed.receipt.projectId);
  await pool.query("UPDATE admin_roles SET active=false WHERE name='FOLLOWER'");
  assert.equal((await getProject(pool, resumedId)).assigneeStatus, 'permission_revoked');
  await assert.rejects(followUpProject(pool, resumedId, target, { requestKey: randomUUID(), expectedRevision: 1, contactMethod: 'email', contactedAt: new Date().toISOString(), content: '撤权后跟进' }), { statusCode: 403 });
  const concurrent = await Promise.allSettled([
    saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: actor, expectedRevision: 1 }),
    saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: null, expectedRevision: 1 }),
  ]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = concurrent.find(result => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && rejected.reason.reason === 'ASSIGNMENT_CONFIG_CHANGED');
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action='project.assignment-config.update'")).rows[0].count, 2);

  await saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: null, expectedRevision: 2 });
  assert.equal((await getProject(pool, resumedId)).assigneeAdminId, target);
  await assert.rejects(createManualProject(pool, user, { ...input, requestKey: randomUUID() }), { reason: 'ASSIGNMENT_UNAVAILABLE' });
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM projects')).rows[0].count, 2);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM project_notification_outbox')).rows[0].count, 2);

  let site: 'admin' | 'client' = 'admin';
  const redis = { get: async () => JSON.stringify({ site, localId: site === 'admin' ? reader : user, sessionVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 }), eval: async () => 1 } as unknown as Redis;
  const appConfig = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: process.env.PROJECT_TEST_DATABASE_URL,
    REDIS_URL: 'redis://localhost', S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000',
    S3_BUCKET: 'test', S3_ACCESS_KEY: 'test', S3_SECRET_KEY: 'test', CORS_ORIGINS: 'http://localhost:5173',
    SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test' });
  const app = await buildApp(appConfig, { database: async () => {}, redis: async () => {}, storage: async () => {} },
    { pool, redis, storage: {} as ReturnType<typeof createStorage> });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test' };
  assert.equal((await app.inject({ url: '/api/v1/admin/project-assignment-config', headers })).json().data.status, 'unconfigured');
  assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/admin/project-assignment-config', headers, payload: { defaultAssigneeAdminId: actor, expectedRevision: 3 } })).statusCode, 403);
  site = 'client';
  const unavailable = await app.inject({ method: 'POST', url: '/api/v1/client/manual-requests', headers, payload: { ...input, requestKey: randomUUID() } });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.json().error.reason, 'ASSIGNMENT_UNAVAILABLE');
  assert.equal(unavailable.json().data, undefined);
  const replay = await app.inject({ method: 'POST', url: '/api/v1/client/manual-requests', headers, payload: input });
  assert.equal(replay.statusCode, 200); assert.equal(replay.json().data.projectId, id);
  const publicProject = await app.inject({ url: `/api/v1/client/me/projects/${resumedId}`, headers });
  assert.equal(publicProject.statusCode, 200);
  assert.ok(!publicProject.body.includes('assigneeStatus'));
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM projects')).rows[0].count, 2);
});
