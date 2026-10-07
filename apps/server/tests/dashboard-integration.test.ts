import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { getDashboardAnalytics } from '../src/modules/dashboard/analytics.js';
import { getDashboardWorkspace } from '../src/modules/dashboard/workspace.js';
import { projectTestPool } from './project-fixtures.js';

test('dashboard analytics aggregates the window by Shanghai day and fills empty buckets', {
  skip: !process.env.PROJECT_TEST_DATABASE_URL,
}, async t => {
  const pool = await projectTestPool(t);
  const permissions = ['users.read', 'search-analytics.read', 'generation.read', 'projects.read'];
  const empty = await getDashboardAnalytics(pool, permissions, 7);
  assert.equal(empty.dates.length, 7);
  assert.equal(empty.months.length, 12);
  assert.deepEqual(empty.overview, ['users', 'searches', 'generations', 'projects'].map(key => ({ key, value: 0, total: 0 })));
  assert.ok(empty.trend.every(series => series.data.length === 7 && series.data.every(value => value === 0)));
  assert.deepEqual(empty.funnel.map(stage => stage.value), [0, 0, 0, 0, 0]);
  assert.deepEqual(empty.monthlyProjects, { created: Array(12).fill(0), won: Array(12).fill(0) });

  const adminId = randomUUID();
  const [buyer, browser, old] = [randomUUID(), randomUUID(), randomUUID()];
  const outside = new Date(Date.now() - 40 * 86_400_000);
  await pool.query("INSERT INTO admins(id,external_user_id,username) VALUES($1,201,'analytics-admin')", [adminId]);
  await pool.query(`INSERT INTO users(id,external_user_id,username,created_at) VALUES
    ($1,202,'analytics-buyer',now()),($2,203,'analytics-browser',now()),($3,204,'analytics-old',$4)`, [buyer, browser, old, outside]);
  // 上海时间今天 00:30 对应 UTC 前一天 16:30，必须计入今天。
  const todayEarly = (await pool.query<{ at: Date }>(`SELECT
    (date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') + interval '30 minutes') AT TIME ZONE 'Asia/Shanghai' AS at`)).rows[0]!.at;
  const attempt = randomUUID();
  await pool.query("INSERT INTO selection_attempts(id,visitor_id) VALUES($1,'visitor-a')", [attempt]);
  for (const [visitor, status, createdAt] of [
    ['visitor-a', 'matched', todayEarly], ['visitor-a', 'no_match', todayEarly], ['visitor-b', 'no_match', todayEarly],
    ['visitor-c', 'matched', outside],
  ] as const) {
    await pool.query(`INSERT INTO selection_searches(attempt_id,visitor_id,mode,status,final_requirement,rules_version,dictionary_version,duration_ms,created_at)
      VALUES($1,$2,'filtered',$3,'{}','test','test',1,$4)`, [attempt, visitor, status, createdAt]);
  }
  for (const [user, status] of [[buyer, 'succeeded'], [buyer, 'running'], [browser, 'failed']] as const) {
    await pool.query(`INSERT INTO theme_jobs(user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,status)
      VALUES($1,'test',$2,'test',$3,'{}',1,$4)`, [user, randomUUID(), randomUUID(), status]);
  }
  await pool.query(`INSERT INTO artwork_jobs(user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,status)
    VALUES($1,'test',$2,'test',$3,'{}',1,'partially_succeeded')`, [buyer, randomUUID(), randomUUID()]);
  for (const [sourceType, customer, status, createdAt] of [
    ['quote_request', buyer, 'won', todayEarly], ['quote_request', buyer, 'quoted', todayEarly],
    ['manual_request', null, 'pending', todayEarly], ['quote_request', old, 'won', outside],
  ] as const) {
    await pool.query(`INSERT INTO projects(request_no,source_type,customer_user_id,assignee_admin_id,status,request_snapshot,created_at)
      VALUES($1,$2,$3,$4,$5,'{}',$6)`, [randomUUID(), sourceType, customer, adminId, status, createdAt]);
  }

  const result = await getDashboardAnalytics(pool, permissions, 7);
  assert.deepEqual(result.overview, [
    { key: 'users', value: 2, total: 3 }, { key: 'searches', value: 3, total: 4 },
    { key: 'generations', value: 4, total: 4 }, { key: 'projects', value: 3, total: 4 },
  ]);
  assert.deepEqual(result.trend.map(series => series.data.at(-1)), [2, 3, 4, 3]);
  assert.deepEqual(result.trend.map(series => series.data.slice(0, -1).reduce((sum, value) => sum + value, 0)), [0, 0, 0, 0]);
  assert.deepEqual(result.funnel, [
    { key: 'visitors', value: 2 }, { key: 'matchedVisitors', value: 1 }, { key: 'generationUsers', value: 2 },
    { key: 'inquiryCustomers', value: 1 }, { key: 'wonCustomers', value: 1 },
  ]);
  assert.deepEqual(result.projectStatuses, [
    { key: 'pending', value: 1 }, { key: 'following', value: 0 }, { key: 'quoted', value: 1 },
    { key: 'won', value: 1 }, { key: 'lost', value: 0 }, { key: 'closed', value: 0 },
  ]);
  assert.deepEqual(result.generationStatuses, [
    { key: 'succeeded', value: 1 }, { key: 'partially_succeeded', value: 1 }, { key: 'failed', value: 1 }, { key: 'processing', value: 1 },
  ]);
  assert.equal(result.monthlyProjects?.created.at(-1), 3);
  assert.equal(result.monthlyProjects?.won.at(-1), 1);

  const limited = await getDashboardAnalytics(pool, ['projects.read'], 30);
  assert.deepEqual(limited.overview.map(item => item.key), ['projects']);
  assert.deepEqual(limited.funnel.map(stage => stage.key), ['inquiryCustomers', 'wonCustomers']);
  assert.equal(limited.generationStatuses, null);
});

test('workspace lists only the signed-in admin actionable projects, activity and unread notifications', {
  skip: !process.env.PROJECT_TEST_DATABASE_URL,
}, async t => {
  const pool = await projectTestPool(t);
  const [me, colleague] = [randomUUID(), randomUUID()];
  await pool.query(`INSERT INTO admins(id,external_user_id,username,nickname) VALUES
    ($1,301,'workspace-me','我'),($2,302,'workspace-colleague','同事')`, [me, colleague]);
  const permissions = ['projects.read', 'notifications.read'];
  const empty = await getDashboardWorkspace(pool, me, permissions);
  assert.deepEqual(empty.projects, { active: 0, pending: 0, todayFollowUps: 0, overdueFollowUps: 0, taskTotal: 0, tasks: [], activities: [] });
  assert.deepEqual(empty.notifications, { unread: 0 });

  const bounds = (await pool.query<{ todayLater: Date; past: Date; future: Date }>(`SELECT
    ((date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') + interval '1 day' - interval '1 minute') AT TIME ZONE 'Asia/Shanghai') AS "todayLater",
    (now() - interval '2 days') AS past,(now() + interval '3 days') AS future`)).rows[0]!;
  async function project(status: string, assignee = me, createdAt = '2026-01-01T00:00:00Z') {
    const id = randomUUID();
    await pool.query(`INSERT INTO projects(id,request_no,source_type,assignee_admin_id,status,request_snapshot,created_at)
      VALUES($1,$2,'manual_request',$3,$4,'{"company":"","contact":{"name":"联系人"},"exhibition":{"name":"上海展"}}',$5)`,
    [id, randomUUID(), assignee, status, createdAt]);
    return id;
  }
  async function event(projectId: string, kind: string, payload: object, actor: string | null, createdAt: string) {
    const id = randomUUID();
    await pool.query('INSERT INTO project_events(id,project_id,kind,actor_admin_id,payload,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, projectId, kind, actor, JSON.stringify(payload), createdAt]);
    return id;
  }
  const pendingOld = await project('pending', me, '2026-01-01T00:00:00Z');
  const pendingNew = await project('pending', me, '2026-01-02T00:00:00Z');
  const today = await project('following');
  await event(today, 'follow-up', { nextFollowUpAt: bounds.todayLater, fromStatus: 'pending', status: 'following' }, me, '2026-01-03T00:00:00Z');
  const overdue = await project('quoted');
  await event(overdue, 'follow-up', { nextFollowUpAt: bounds.past, fromStatus: 'following', status: 'quoted' }, colleague, '2026-01-04T00:00:00Z');
  const scheduled = await project('following');
  await event(scheduled, 'follow-up', { nextFollowUpAt: bounds.future, status: 'following' }, me, '2026-01-05T00:00:00Z');
  const won = await project('won');
  await event(won, 'follow-up', { nextFollowUpAt: bounds.past, status: 'won' }, me, '2026-01-06T00:00:00Z');
  const others = await project('pending', colleague);
  await event(pendingNew, 'quotation', { quotationRevision: 2 }, me, '2026-01-08T00:00:00Z');
  const acceptedId = await event(pendingOld, 'accepted', {}, null, '2026-01-09T00:00:00Z');

  const otherEventId = await event(others, 'accepted', {}, null, '2026-01-07T00:00:00Z');
  for (const [projectId, eventId] of [[pendingOld, acceptedId], [others, otherEventId]]) {
    await pool.query('INSERT INTO project_notification_outbox(project_id,event_id) VALUES($1,$2)', [projectId, eventId]);
  }
  await pool.query(`INSERT INTO project_notification_reads(notification_id,admin_id)
    SELECT id,$1 FROM project_notification_outbox WHERE project_id=$2`, [me, pendingOld]);

  const result = await getDashboardWorkspace(pool, me, permissions);
  const projects = result.projects!;
  assert.deepEqual([projects.active, projects.pending, projects.todayFollowUps, projects.overdueFollowUps, projects.taskTotal], [5, 2, 1, 1, 4]);
  assert.deepEqual(projects.tasks.map(task => [task.projectId, task.reason]),
    [[overdue, 'overdue'], [today, 'today'], [pendingOld, 'pending'], [pendingNew, 'pending']]);
  assert.equal(projects.tasks[0]?.company, null);
  assert.equal(projects.tasks[0]?.exhibitionName, '上海展');
  assert.equal(projects.tasks[0]?.nextFollowUpAt, bounds.past.toISOString());
  assert.deepEqual(projects.activities.map(activity => activity.projectId), [pendingOld, pendingNew, won, scheduled, overdue, today]);
  assert.deepEqual(projects.activities[0], {
    id: acceptedId, kind: 'accepted', projectId: pendingOld, projectNo: projects.activities[0]!.projectNo, actorName: null, byMe: false,
    fromStatus: null, toStatus: null, schemeCode: null, quotationRevision: null, createdAt: '2026-01-09T00:00:00.000Z',
  });
  assert.equal(projects.activities[1]?.quotationRevision, 2);
  assert.deepEqual([projects.activities[4]?.actorName, projects.activities[4]?.byMe, projects.activities[4]?.fromStatus, projects.activities[4]?.toStatus],
    ['同事', false, 'following', 'quoted']);
  assert.equal(projects.activities[5]?.byMe, true);
  assert.deepEqual(result.notifications, { unread: 1 });
  assert.deepEqual(await getDashboardWorkspace(pool, colleague, ['projects.read']).then(data => data.projects?.tasks.map(task => task.projectId)), [others]);
});
