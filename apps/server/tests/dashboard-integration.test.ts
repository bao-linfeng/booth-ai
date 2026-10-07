import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { getDashboardAnalytics } from '../src/modules/dashboard/analytics.js';
import { getDashboardSummary } from '../src/modules/dashboard/service.js';
import { projectTestPool } from './project-fixtures.js';

test('dashboard counts persisted states, latest follow-up schedules and recent quote requests', {
  skip: !process.env.PROJECT_TEST_DATABASE_URL,
}, async t => {
  const pool = await projectTestPool(t);
  const permissions = ['projects.read', 'schemes.read', 'generation.read', 'notifications.read'];
  const empty = await getDashboardSummary(pool, permissions);
  assert.deepEqual(empty.projects, { pending: 0, todayFollowUps: 0, overdueFollowUps: 0, recentInquiries: [] });
  assert.deepEqual(empty.schemes, { unverified: 0 });
  assert.deepEqual(empty.generation, { failed: 0 });
  assert.deepEqual(empty.notifications, { failed: 0 });
  const adminId = randomUUID();
  const userId = randomUUID();
  await pool.query("INSERT INTO admins(id,external_user_id,username) VALUES($1,101,'dashboard-admin')", [adminId]);
  await pool.query("INSERT INTO users(id,external_user_id,username) VALUES($1,102,'dashboard-user')", [userId]);
  const bounds = (await pool.query<{ today: string; yesterday: string; tomorrow: string }>(`SELECT
    ((date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') + interval '12 hours') AT TIME ZONE 'Asia/Shanghai') AS today,
    (now() - interval '2 days') AS yesterday,(now() + interval '2 days') AS tomorrow`)).rows[0]!;
  async function project(status: string, sourceType = 'manual_request', createdAt = '2026-01-01T00:00:00Z') {
    const id = randomUUID();
    await pool.query(`INSERT INTO projects(id,request_no,source_type,assignee_admin_id,status,request_snapshot,created_at)
      VALUES($1,$2,$3,$4,$5,'{"company":"真实客户","contact":{"name":"联系人"}}',$6)`,
    [id, randomUUID(), sourceType, adminId, status, createdAt]);
    return id;
  }
  async function followUp(projectId: string, nextFollowUpAt?: string, createdAt = '2026-01-01T00:00:00Z') {
    await pool.query(`INSERT INTO project_events(project_id,kind,payload,created_at) VALUES($1,'follow-up',$2,$3)`,
      [projectId, JSON.stringify({ nextFollowUpAt }), createdAt]);
  }
  await project('pending');
  const today = await project('following');
  await followUp(today, bounds.today);
  const overdue = await project('quoted');
  await followUp(overdue, bounds.yesterday);
  const rescheduled = await project('following');
  await followUp(rescheduled, bounds.yesterday);
  await followUp(rescheduled, bounds.tomorrow, '2026-01-02T00:00:00Z');
  const cleared = await project('following');
  await followUp(cleared, bounds.yesterday);
  await followUp(cleared, undefined, '2026-01-02T00:00:00Z');
  for (const status of ['won', 'lost', 'closed']) {
    await followUp(await project(status), bounds.yesterday);
  }
  const inquiryIds: string[] = [];
  for (let i = 0; i < 6; i++) inquiryIds.push(await project(i === 5 ? 'won' : 'quoted', 'quote_request', `2026-09-0${i + 1}T00:00:00Z`));
  await project('following', 'manual_request', '2026-09-07T00:00:00Z');
  for (const verification of ['unverified', 'verified', 'failed']) {
    await pool.query('INSERT INTO schemes(code,name,verification_status) VALUES($1,$1,$2)', [randomUUID(), verification]);
  }
  for (const status of ['failed', 'succeeded', 'partially_succeeded']) {
    await pool.query(`INSERT INTO theme_jobs(user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,status)
      VALUES($1,'test',$2,'test',$3,'{}',1,$4)`, [userId, randomUUID(), randomUUID(), status]);
  }
  await pool.query(`INSERT INTO artwork_jobs(user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,status)
    VALUES($1,'test',$2,'test',$3,'{}',1,'failed')`, [userId, randomUUID(), randomUUID()]);
  for (const delivery of ['failed', 'delivered', 'pending', 'recovered']) {
    const eventId = randomUUID();
    await pool.query("INSERT INTO project_events(id,project_id,kind,payload) VALUES($1,$2,'accepted','{}')", [eventId, overdue]);
    await pool.query(`INSERT INTO project_notification_outbox(project_id,event_id,failed_at,delivered_at)
      VALUES($1,$2,$3,$4)`, [overdue, eventId, ['failed', 'recovered'].includes(delivery) ? new Date() : null,
      ['delivered', 'recovered'].includes(delivery) ? new Date() : null]);
  }
  const result = await getDashboardSummary(pool, permissions);
  assert.equal(result.projects?.pending, 1);
  assert.equal(result.projects?.todayFollowUps, 1);
  const now = Date.now();
  assert.equal(result.projects?.overdueFollowUps, 1 + (new Date(bounds.today).getTime() < now ? 1 : 0));
  assert.deepEqual(result.projects?.recentInquiries.map(item => item.projectId), inquiryIds.slice(1).reverse());
  assert.equal(result.projects?.recentInquiries[0]?.status, 'won');
  assert.equal(result.projects?.recentInquiries[0]?.company, '真实客户');
  assert.deepEqual(result.schemes, { unverified: 1 });
  assert.deepEqual(result.generation, { failed: 2 });
  assert.deepEqual(result.notifications, { failed: 1 });
});

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
