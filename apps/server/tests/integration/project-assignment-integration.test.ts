import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Redis } from 'ioredis';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { projectTestPool } from '../helpers/project-fixtures.js';
import { getAssignmentConfig } from '../../src/modules/projects/assignment.js';
import {
  assignProject,
  claimProject,
  followUpProject,
  linkProjectScheme,
  saveAssignmentConfig,
  saveQuotation,
} from '../../src/modules/projects/admin-service.js';
import { createManualProject } from '../../src/modules/projects/service.js';
import { getProject, listProjects } from '../../src/modules/projects/repository.js';
import { listNotificationInbox, markAllNotificationsRead, markNotificationRead } from '../../src/modules/projects/notification-inbox.js';
import { emptyRequirement } from '../../src/modules/selection/domain.js';
import type { ManualInput } from '../../src/modules/projects/domain.js';
import { routePermissions } from '../helpers/admin-route-policies.js';
import type { createStorage } from '../../src/infra/storage.js';

test('assignment configuration and claim route permissions are explicit', async () => {
  const adminRoutePermissions = await routePermissions();
  assert.deepEqual(adminRoutePermissions('GET', '/api/v1/admin/project-assignment-config'), ['projects.read']);
  assert.deepEqual(adminRoutePermissions('PUT', '/api/v1/admin/project-assignment-config'), ['projects.assign']);
  assert.deepEqual(adminRoutePermissions('POST', '/api/v1/admin/projects/:projectId/claim'), ['projects.follow-up']);
});

test(
  'assignment pool: acceptance never pauses, claim and assignment, ASSIGNEE_REQUIRED, notification audience and audit',
  {
    skip: !process.env.PROJECT_TEST_DATABASE_URL,
  },
  async t => {
    const pool = await projectTestPool(t);
    const actor = randomUUID();
    const target = randomUUID();
    const peer = randomUUID();
    const user = randomUUID();
    const reader = randomUUID();
    await pool.query(`INSERT INTO admin_roles(id,name,permission_codes) VALUES
    (100,'FOLLOWER',ARRAY['projects.read','projects.follow-up']), (101,'READER',ARRAY['projects.read'])`);
    for (const [index, [id, role]] of [
      [actor, 'ROLE_ADMIN'],
      [target, 'FOLLOWER'],
      [reader, 'READER'],
      [peer, 'FOLLOWER'],
    ].entries()) {
      await pool.query('INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,$2,$1::uuid::text,$3)', [id, index + 1, [role]]);
    }
    await pool.query('INSERT INTO users(id,external_user_id,username) VALUES($1,1,$1::uuid::text)', [user]);
    const input: ManualInput = {
      requestKey: randomUUID(),
      entryPoint: 'matching_results',
      originalDescription: '需人工确认',
      confirmedRequirements: emptyRequirement(),
      exhibition: { name: '测试展会', countryCode: 'CN', city: '上海', startDate: '2026-11-20', endDate: '2026-11-22' },
      scopeCodes: ['materials'],
      materialBudget: { currency: 'CNY', amount: '30000' },
      customerType: 'individual',
      contact: { name: '客户', email: 'test@example.com' },
    };
    const accepted = async (projectId: string) =>
      (
        await pool.query(
          `SELECT e.payload,o.audience FROM project_events e JOIN project_notification_outbox o ON o.event_id=e.id
        WHERE e.project_id=$1 AND e.kind='accepted'`,
          [projectId],
        )
      ).rows[0];
    const pooled = async (poolReason: string) => {
      const created = await createManualProject(pool, user, { ...input, requestKey: randomUUID() });
      const id = String(created.receipt.projectId);
      const project = await getProject(pool, id);
      assert.deepEqual([project.assigneeAdminId, project.assigneeName, project.assigneeStatus], [null, null, 'unassigned']);
      assert.deepEqual(await accepted(id), {
        payload: { assigneeAdminId: null, poolReason, revision: 1 },
        audience: 'assigners',
      });
      return id;
    };

    // 未配置、已停用、缺少权限三种情况都照常受理，项目进入待分配池
    assert.equal((await getAssignmentConfig(pool)).status, 'unconfigured');
    const unconfigured = await pooled('unconfigured');
    await assert.rejects(saveAssignmentConfig(pool, reader, { defaultAssigneeAdminId: target, expectedRevision: 0 }), { statusCode: 403 });
    await assert.rejects(saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: reader, expectedRevision: 0 }), {
      reason: 'INVALID_ASSIGNEE',
    });
    const config = await saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: target, expectedRevision: 0 });
    assert.equal(config.status, 'active');
    assert.equal(config.revision, 1);
    const assigned = await createManualProject(pool, user, input);
    const id = String(assigned.receipt.projectId);
    assert.equal((await getProject(pool, id)).assigneeAdminId, target);
    assert.deepEqual(await accepted(id), { payload: { assigneeAdminId: target, revision: 1 }, audience: 'all' });
    await pool.query('UPDATE admins SET enabled=false WHERE id=$1', [target]);
    assert.equal((await getAssignmentConfig(pool)).status, 'disabled');
    // 已受理项目保留历史负责人，不自动转入待分配池
    const retained = await getProject(pool, id);
    assert.equal(retained.assigneeAdminId, target);
    assert.equal(retained.assigneeStatus, 'disabled');
    assert.equal(retained.revision, 1);
    assert.deepEqual((await createManualProject(pool, user, input)).receipt, assigned.receipt);
    const disabled = await pooled('disabled');
    await assert.rejects(
      followUpProject(pool, id, target, {
        requestKey: randomUUID(),
        expectedRevision: 1,
        contactMethod: 'email',
        contactedAt: new Date().toISOString(),
        content: '停用后跟进',
      }),
      { statusCode: 403 },
    );
    const assignment = { requestKey: randomUUID(), expectedRevision: 1, assigneeAdminId: actor, reason: '承接人停用，人工改派' };
    const reassigned = await assignProject(pool, id, actor, assignment);
    assert.deepEqual(reassigned, { projectId: id, revision: 2, assigneeAdminId: actor });
    assert.deepEqual(await assignProject(pool, id, actor, assignment), reassigned);
    assert.equal(Object.hasOwn(await getProject(pool, id), 'attribution'), false);
    assert.equal((await getProject(pool, id)).assigneeStatus, 'active');
    assert.equal((await getAssignmentConfig(pool)).defaultAssigneeAdminId, target);
    await pool.query('UPDATE admins SET enabled=true WHERE id=$1', [target]);
    await pool.query("UPDATE admin_roles SET permission_codes=ARRAY['projects.read'] WHERE name='FOLLOWER'");
    assert.equal((await getAssignmentConfig(pool)).status, 'permission_revoked');
    const revoked = await pooled('permission_revoked');
    await assert.rejects(saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: target, expectedRevision: 1 }), {
      reason: 'INVALID_ASSIGNEE',
    });
    await pool.query("UPDATE admin_roles SET permission_codes=ARRAY['projects.read','projects.follow-up'] WHERE name='FOLLOWER'");

    // 待分配项目必须先确定负责人
    const change = { requestKey: randomUUID(), expectedRevision: 1 };
    await assert.rejects(
      followUpProject(pool, unconfigured, actor, {
        ...change,
        contactMethod: 'email',
        contactedAt: new Date().toISOString(),
        content: '未分配时跟进',
      }),
      { reason: 'ASSIGNEE_REQUIRED', statusCode: 409 },
    );
    await assert.rejects(
      saveQuotation(pool, unconfigured, actor, {
        ...change,
        expectedQuotationRevision: 0,
        currency: 'CNY',
        priceBasis: 'included',
        validUntil: '2026-12-31',
        validityTimeZone: 'Asia/Shanghai',
        items: [],
        terms: '',
        inclusions: '',
        exclusions: '',
        changeReason: '首次报价',
      }),
      { reason: 'ASSIGNEE_REQUIRED', statusCode: 409 },
    );
    await assert.rejects(linkProjectScheme(pool, unconfigured, actor, { ...change, schemeCode: 'ANY', confirmationNote: '客户确认' }), {
      reason: 'ASSIGNEE_REQUIRED',
      statusCode: 409,
    });

    // 领取：无承接资格的人 403；两人并发领取只有一人成功
    await assert.rejects(claimProject(pool, unconfigured, reader, { requestKey: randomUUID() }), { statusCode: 403 });
    const claimKeys = { [target]: randomUUID(), [peer]: randomUUID() };
    const claims = await Promise.allSettled(
      [target, peer].map(admin => claimProject(pool, unconfigured, admin, { requestKey: claimKeys[admin]! })),
    );
    const won = claims.find(result => result.status === 'fulfilled');
    const lost = claims.find(result => result.status === 'rejected');
    assert.ok(won?.status === 'fulfilled' && lost?.status === 'rejected');
    const claimer = won.value.assigneeAdminId;
    assert.deepEqual(won.value, { projectId: unconfigured, revision: 2, assigneeAdminId: claimer });
    assert.equal(lost.reason.reason, 'PROJECT_ALREADY_ASSIGNED');
    assert.equal(lost.reason.statusCode, 409);
    assert.deepEqual(lost.reason.details, { assigneeAdminId: claimer, assigneeName: claimer });
    assert.deepEqual(await claimProject(pool, unconfigured, claimer, { requestKey: claimKeys[claimer]! }), won.value);
    assert.deepEqual(
      (
        await pool.query("SELECT actor_admin_id AS actor,payload FROM project_events WHERE project_id=$1 AND kind='assignment'", [
          unconfigured,
        ])
      ).rows,
      [{ actor: claimer, payload: { fromAdminId: null, assigneeAdminId: claimer, selfClaimed: true, revision: 2 } }],
    );
    // 领取后可以正常跟进
    await followUpProject(pool, unconfigured, claimer, {
      requestKey: randomUUID(),
      expectedRevision: 2,
      contactMethod: 'phone',
      contactedAt: new Date().toISOString(),
      content: '领取后跟进',
      targetStatus: 'following',
    });

    // 分配：从待分配分配给他人时，新承接人收到只有本人可见的通知
    await assignProject(pool, disabled, actor, { requestKey: randomUUID(), expectedRevision: 1, assigneeAdminId: target, reason: '分配' });
    assert.deepEqual(
      (
        await pool.query(
          `SELECT e.payload->>'fromAdminId' AS "from",o.audience,o.recipient_admin_id AS recipient FROM project_notification_outbox o
        JOIN project_events e ON e.id=o.event_id WHERE o.project_id=$1 AND e.kind='assignment'`,
          [disabled],
        )
      ).rows,
      [{ from: null, audience: 'recipient', recipient: target }],
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS count FROM project_notification_outbox WHERE audience='recipient'")).rows[0].count,
      1,
      '分配给自己和领取都不发通知',
    );

    // 通知可见性：待分配通知只对有分配权限的人可见，分配通知只对新承接人可见
    const visible = async (adminId: string, canAssign: boolean) =>
      (await listNotificationInbox(pool, adminId, canAssign, { pageSize: 100 })).items.map(item => `${item.projectId}:${item.kind}`).sort();
    const everyone = [`${id}:accepted`];
    const assignerOnly = [unconfigured, disabled, revoked].map(projectId => `${projectId}:accepted`);
    assert.deepEqual(await visible(actor, true), [...everyone, ...assignerOnly].sort());
    assert.deepEqual(await visible(reader, false), everyone);
    assert.deepEqual(await visible(target, false), [...everyone, `${disabled}:assignment`].sort());
    assert.equal((await listNotificationInbox(pool, reader, false, {})).unreadCount, 1);
    assert.deepEqual(
      (await listNotificationInbox(pool, target, false, { kind: 'assignment' })).items.map(item => [item.projectId, item.audience]),
      [[disabled, 'recipient']],
    );
    assert.equal(
      (await listNotificationInbox(pool, actor, true, { pageSize: 100 })).items.find(item => item.projectId === unconfigured)?.audience,
      'assigners',
    );
    const hidden = (await pool.query("SELECT id FROM project_notification_outbox WHERE audience='recipient'")).rows[0].id;
    await assert.rejects(markNotificationRead(pool, reader, false, hidden), { statusCode: 404 });
    assert.equal(await markAllNotificationsRead(pool, reader, false), 1);
    assert.equal(await markAllNotificationsRead(pool, target, false), 2);

    // 列表筛选：待分配 / 需处理分配（含承接人失效且未结束）
    const listed = async (assignmentFilter: 'needs_assignment' | 'unassigned') =>
      (await listProjects(pool, { assignment: assignmentFilter })).items.map(item => item.projectId).sort();
    assert.deepEqual(await listed('unassigned'), [revoked]);
    await pool.query('UPDATE admins SET enabled=false WHERE id=$1', [target]);
    assert.deepEqual(await listed('needs_assignment'), [disabled, revoked, ...(claimer === target ? [unconfigured] : [])].sort());
    await pool.query('UPDATE admins SET enabled=true WHERE id=$1', [target]);

    const concurrent = await Promise.allSettled([
      saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: actor, expectedRevision: 1 }),
      saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: null, expectedRevision: 1 }),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = concurrent.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && rejected.reason.reason === 'ASSIGNMENT_CONFIG_CHANGED');
    assert.equal(
      (await pool.query("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action='project.assignment-config.update'")).rows[0]
        .count,
      2,
    );
    await saveAssignmentConfig(pool, actor, { defaultAssigneeAdminId: null, expectedRevision: 2 });

    let site: 'admin' | 'client' = 'admin';
    const redis = {
      get: async () =>
        JSON.stringify({
          site,
          localId: site === 'admin' ? reader : user,
          sessionVersion: 1,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        }),
      eval: async () => 1,
    } as unknown as Redis;
    const appConfig = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: process.env.PROJECT_TEST_DATABASE_URL,
      REDIS_URL: 'redis://localhost',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:19000',
      S3_BUCKET: 'test',
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
      CORS_ORIGINS: 'http://localhost:5173',
      SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes',
      AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
      EXTERNAL_API_URL: 'https://api.example.test',
    });
    const app = await buildApp(
      appConfig,
      { database: async () => {}, redis: async () => {}, storage: async () => {} },
      { pool, redis, storage: {} as ReturnType<typeof createStorage> },
    );
    t.after(() => app.close());
    const headers = { authorization: 'Bearer test' };
    assert.equal((await app.inject({ url: '/api/v1/admin/project-assignment-config', headers })).json().data.status, 'unconfigured');
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/admin/project-assignment-config',
          headers,
          payload: { defaultAssigneeAdminId: actor, expectedRevision: 3 },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: `/api/v1/admin/projects/${revoked}/claim`, headers, payload: { requestKey: randomUUID() } }))
        .statusCode,
      403,
    );
    const detail = await app.inject({ url: `/api/v1/admin/projects/${revoked}`, headers });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(
      [detail.json().data.assigneeAdminId, detail.json().data.assigneeName, detail.json().data.assigneeStatus],
      [null, null, 'unassigned'],
    );
    const list = await app.inject({ url: '/api/v1/admin/projects?assignment=unassigned', headers });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(
      list.json().data.items.map((item: { projectId: string }) => item.projectId),
      [revoked],
    );
    assert.ok(list.json().data.items.every((item: Record<string, unknown>) => !Object.hasOwn(item, 'attribution')));
    site = 'client';
    // 清空默认承接人后客户端照常提交，不再出现"暂停受理"
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/v1/client/manual-requests',
      headers,
      payload: { ...input, requestKey: randomUUID() },
    });
    assert.equal(submitted.statusCode, 201);
    assert.equal((await getProject(pool, submitted.json().data.projectId)).assigneeAdminId, null);
    const replay = await app.inject({ method: 'POST', url: '/api/v1/client/manual-requests', headers, payload: input });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().data.projectId, id);
    const publicProject = await app.inject({ url: `/api/v1/client/me/projects/${revoked}`, headers });
    assert.equal(publicProject.statusCode, 200);
    assert.ok(!publicProject.body.includes('assignee'));
  },
);
