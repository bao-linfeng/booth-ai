import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Redis } from 'ioredis';
import { projectTestPool } from '../helpers/project-fixtures.js';
import { contractApp } from '../helpers/http-app.js';
import { createManualProject } from '../../src/modules/projects/service.js';
import { followUpProject, listQuotationRevisions, saveQuotation } from '../../src/modules/projects/admin-service.js';
import { getProject, listProjects } from '../../src/modules/projects/repository.js';
import { claimQuotationEmails, completeQuotationEmail, failQuotationEmail } from '../../src/modules/projects/quotation-emails.js';
import { emptyRequirement } from '../../src/modules/selection/domain.js';
import { registerAuthentication } from '../../src/http/authentication.js';
import { registerAdminProjectRoutes } from '../../src/http/admin/projects/index.js';
import type { createStorage } from '../../src/infra/storage.js';
import type { ManualInput } from '../../src/modules/projects/domain.js';
import type { QuotationInput } from '../../src/modules/projects/quotation.js';

test(
  'project workflow: save-and-send quotation, pending → quoted, revisions, public result and follow-up filters',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL },
  async t => {
    const pool = await projectTestPool(t);
    const admin = randomUUID();
    const quoter = randomUUID();
    const colleague = randomUUID();
    const user = randomUUID();
    await pool.query(`INSERT INTO admin_roles(id,name,permission_codes) VALUES (100,'QUOTER',ARRAY['projects.read','projects.quotation'])`);
    for (const [index, [id, role]] of [
      [admin, 'ROLE_ADMIN'],
      [quoter, 'QUOTER'],
      [colleague, 'ROLE_ADMIN'],
    ].entries())
      await pool.query('INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,$2,$1::uuid::text,$3)', [id, index + 1, [role]]);
    await pool.query('INSERT INTO users(id,external_user_id,username) VALUES($1,1,$1::uuid::text)', [user]);
    await pool.query('UPDATE project_assignment_config SET default_assignee_admin_id=$1', [admin]);
    const input: ManualInput = {
      requestKey: randomUUID(),
      entryPoint: 'matching_results',
      originalDescription: '需要报价',
      confirmedRequirements: emptyRequirement(),
      exhibition: { name: '流程展会', countryCode: 'CN', city: '上海', startDate: '2026-11-20', endDate: '2026-11-22' },
      scopeCodes: ['materials'],
      materialBudget: { currency: 'CNY', amount: '30000' },
      customerType: 'individual',
      contact: { name: '客户', email: 'workflow@example.com' },
    };
    const create = async () => String((await createManualProject(pool, user, { ...input, requestKey: randomUUID() })).receipt.projectId);
    const id = await create();
    const projectNo = (await getProject(pool, id)).projectNo;
    const quote: QuotationInput = {
      requestKey: randomUUID(),
      expectedRevision: 1,
      expectedQuotationRevision: 0,
      currency: 'CNY',
      priceBasis: 'excluded',
      validUntil: '2099-12-31',
      validityTimeZone: 'Asia/Shanghai',
      items: [{ clientLineId: 'service', kind: 'other', name: '测试服务', quantity: '3', pricingUnit: '项', unitPrice: '0.335' }],
      terms: '税费另行确认',
      inclusions: '测试服务',
      exclusions: '运输与搭建',
      changeReason: '首次报价',
    };
    const revisions = async () => (await pool.query('SELECT count(*)::int AS count FROM project_quotation_revisions')).rows[0].count;

    const emails = async () =>
      (
        await pool.query(
          'SELECT project_id AS "projectId",quotation_revision AS revision,recipient,locale,requested_by AS "requestedBy" FROM project_quotation_emails ORDER BY created_at',
        )
      ).rows;
    // 修订不完整、已过有效期、客户没有邮箱或缺少跟进权限时整体失败，修订和邮件都不落库
    await assert.rejects(saveQuotation(pool, id, admin, { ...quote, items: [{ ...quote.items[0]!, unitPrice: null }], sendEmail: true }), {
      reason: 'QUOTATION_INCOMPLETE',
      statusCode: 422,
    });
    await assert.rejects(
      saveQuotation(pool, id, admin, { ...quote, requestKey: randomUUID(), validUntil: '2020-01-01', sendEmail: true }),
      { reason: 'QUOTATION_EXPIRED', statusCode: 422 },
    );
    await assert.rejects(saveQuotation(pool, id, quoter, { ...quote, requestKey: randomUUID(), sendEmail: true }), {
      statusCode: 403,
    });
    const phoneOnly = String(
      (await createManualProject(pool, user, { ...input, requestKey: randomUUID(), contact: { name: '客户', phone: '13800000000' } }))
        .receipt.projectId,
    );
    await assert.rejects(saveQuotation(pool, phoneOnly, admin, { ...quote, requestKey: randomUUID(), sendEmail: true }), {
      reason: 'CUSTOMER_EMAIL_MISSING',
      statusCode: 422,
    });
    // 只用于上面的校验，退回待分配以免影响后面“我的项目”断言
    await pool.query('UPDATE projects SET assignee_admin_id=NULL WHERE id=$1', [phoneOnly]);
    assert.equal(await revisions(), 0);
    assert.deepEqual(await emails(), []);
    assert.deepEqual([(await getProject(pool, id)).status, (await getProject(pool, id)).revision], ['pending', 1]);

    // 待跟进项目一步保存完整报价、放入邮件队列并转为已报价，项目修订只加一次；范围与条款为选填
    const sendKey = { ...quote, requestKey: randomUUID(), inclusions: '', exclusions: '', terms: '', sendEmail: true };
    const sent = await saveQuotation(pool, id, admin, sendKey);
    assert.deepEqual([sent.status, sent.projectRevision, sent.quotation.revision], ['quoted', 2, 1]);
    assert.deepEqual(await saveQuotation(pool, id, admin, sendKey), JSON.parse(JSON.stringify(sent)));
    assert.deepEqual([(await getProject(pool, id)).status, (await getProject(pool, id)).revision], ['quoted', 2]);
    const events = (
      await pool.query<{ kind: string; payload: Record<string, unknown> }>(
        'SELECT kind,payload FROM project_events WHERE project_id=$1 ORDER BY created_at DESC,id DESC',
        [id],
      )
    ).rows;
    assert.deepEqual(
      events.map(event => event.kind),
      ['follow-up', 'quotation', 'accepted'],
    );
    const followUp = events[0]!.payload;
    assert.equal(followUp.content, `系统邮件发送报价 QT-${projectNo} r1`);
    assert.deepEqual([followUp.contactMethod, followUp.fromStatus, followUp.status, followUp.revision], ['email', 'pending', 'quoted', 2]);
    assert.deepEqual(followUp.quoteEvidence, {
      type: 'platform',
      quotationRevision: 1,
      sentAt: sent.quotation.createdAt,
      channel: 'email',
    });
    // 已报价的项目再次发送只记录一次发送
    const resent = await saveQuotation(pool, id, admin, {
      ...quote,
      requestKey: randomUUID(),
      expectedRevision: 2,
      expectedQuotationRevision: 1,
      changeReason: '调价',
      sendEmail: true,
    });
    assert.deepEqual([resent.status, resent.projectRevision], ['quoted', 3]);
    // 重放不重复入队；语言沿用受理回执
    assert.deepEqual(await emails(), [
      { projectId: id, revision: 1, recipient: 'workflow@example.com', locale: 'zh', requestedBy: admin },
      { projectId: id, revision: 2, recipient: 'workflow@example.com', locale: 'zh', requestedBy: admin },
    ]);
    // Worker 领取带上修订快照；送达与终态失败写入时间线，临时失败不写
    const claimed = await claimQuotationEmails(pool);
    assert.deepEqual(
      claimed.map(email => [email.quotation.revision, email.projectNo, email.contact.email, email.attempts]),
      [
        [1, projectNo, 'workflow@example.com', 1],
        [2, projectNo, 'workflow@example.com', 1],
      ],
    );
    assert.deepEqual(await claimQuotationEmails(pool), [], 'leased emails are not claimed twice');
    await completeQuotationEmail(pool, claimed[0]!.id);
    assert.equal(await failQuotationEmail(pool, claimed[1]!, 'SMTP_ECONNECTION', false), false);
    assert.equal(await failQuotationEmail(pool, claimed[1]!, 'SMTP_EENVELOPE', true), true);
    assert.deepEqual(
      (
        await pool.query(
          `SELECT actor_admin_id AS actor,payload FROM project_events WHERE project_id=$1 AND kind='quotation-email' ORDER BY created_at`,
          [id],
        )
      ).rows,
      [
        {
          actor: null,
          payload: { status: 'delivered', quotationRevision: 1, recipient: 'workflow@example.com', errorCode: null },
        },
        {
          actor: null,
          payload: { status: 'failed', quotationRevision: 2, recipient: 'workflow@example.com', errorCode: 'SMTP_EENVELOPE' },
        },
      ],
    );
    assert.deepEqual(
      (await listQuotationRevisions(pool, id)).map(row => [row.revision, row.completeness, row.totalAmount, row.createdByName]),
      [
        [2, 'ready', '1.01', admin],
        [1, 'ready', '1.01', admin],
      ],
    );

    // 待跟进可以直接登记外部报价转为已报价
    const external = await create();
    const now = Date.now();
    const overdue = await followUpProject(pool, external, admin, {
      requestKey: randomUUID(),
      expectedRevision: 1,
      contactMethod: 'email',
      contactedAt: new Date(now - 3 * 86400000).toISOString(),
      content: '邮件发送外部报价',
      targetStatus: 'quoted',
      nextFollowUpAt: new Date(now - 2 * 86400000).toISOString(),
      quoteEvidence: { type: 'external_manual', reference: 'EXT-1', sentAt: new Date(now - 3 * 86400000).toISOString(), channel: 'email' },
    });
    assert.equal(overdue.status, 'quoted');

    // 跟进提醒筛选与工作台同一口径：只看最新一条跟进记录，且只看未结束项目
    const todayLater = (
      await pool.query<{ at: Date }>(
        `SELECT ((date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') + interval '1 day' - interval '1 minute') AT TIME ZONE 'Asia/Shanghai') AS at`,
      )
    ).rows[0]!.at;
    const today = await create();
    await followUpProject(pool, today, admin, {
      requestKey: randomUUID(),
      expectedRevision: 1,
      contactMethod: 'phone',
      contactedAt: new Date(now - 60000).toISOString(),
      content: '约定今天回电',
      targetStatus: 'following',
      nextFollowUpAt: todayLater.toISOString(),
    });
    const filtered = async (followUpFilter: 'overdue' | 'today') =>
      (await listProjects(pool, { followUp: followUpFilter })).items.map(item => item.projectId);
    assert.deepEqual(await filtered('overdue'), [external]);
    assert.deepEqual(await filtered('today'), [today]);
    const listed = (await listProjects(pool, {})).items;
    assert.equal(
      listed.find(item => item.projectId === external)?.nextFollowUpAt?.toISOString(),
      new Date(now - 2 * 86400000).toISOString(),
    );
    assert.equal(listed.find(item => item.projectId === id)?.nextFollowUpAt, null);

    // HTTP：mine、修订列表、客户可见结果，跟进接口不再接受 publicResult
    await pool.query('UPDATE projects SET assignee_admin_id=$2 WHERE id=$1', [today, colleague]);
    const redis = {
      get: async () =>
        JSON.stringify({ site: 'admin', localId: admin, sessionVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
      eval: async () => 1,
    } as unknown as Redis;
    const app = contractApp();
    t.after(() => app.close());
    registerAuthentication(app, pool, redis, 'admin');
    await registerAdminProjectRoutes(app, pool, {} as ReturnType<typeof createStorage>);
    const headers = { authorization: 'Bearer test-token' };
    const mine = await app.inject({ url: `/projects?mine=true&assigneeAdminId=${colleague}`, headers });
    assert.equal(mine.statusCode, 200);
    assert.deepEqual(
      mine
        .json()
        .data.items.map((item: { projectId: string }) => item.projectId)
        .sort(),
      [id, external].sort(),
    );
    const overdueList = await app.inject({ url: '/projects?followUp=overdue', headers });
    assert.equal(overdueList.json().data.items[0].nextFollowUpAt, new Date(now - 2 * 86400000).toISOString());
    const revisionList = await app.inject({ url: `/projects/${id}/quotation/revisions`, headers });
    assert.equal(revisionList.statusCode, 200);
    assert.deepEqual(
      revisionList.json().data.map((row: { revision: number }) => row.revision),
      [2, 1],
    );
    assert.equal((await app.inject({ url: `/projects/${randomUUID()}/quotation/revisions`, headers })).statusCode, 404);
    const rejected = await app.inject({
      method: 'POST',
      url: `/projects/${id}/follow-ups`,
      headers,
      payload: {
        requestKey: randomUUID(),
        expectedRevision: 3,
        contactMethod: 'email',
        contactedAt: new Date().toISOString(),
        content: '旧字段',
        publicResult: '不再支持',
      },
    });
    assert.equal(rejected.statusCode, 400);
    const freeChannel = await app.inject({
      method: 'POST',
      url: `/projects/${id}/follow-ups`,
      headers,
      payload: {
        requestKey: randomUUID(),
        expectedRevision: 3,
        contactMethod: 'email',
        contactedAt: new Date().toISOString(),
        content: '自由文本渠道',
        targetStatus: 'following',
        quoteEvidence: { type: 'external_manual', reference: 'X', sentAt: new Date().toISOString(), channel: '微信' },
      },
    });
    assert.equal(freeChannel.statusCode, 400);
    const published = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/public-result`,
      headers,
      payload: { requestKey: randomUUID(), expectedRevision: 3, publicResult: '报价已发送，等待确认' },
    });
    assert.equal(published.statusCode, 200);
    assert.deepEqual(published.json().data, { projectId: id, revision: 4, publicResult: '报价已发送，等待确认' });
    const project = await getProject(pool, id);
    assert.deepEqual([project.publicResult, project.status, project.revision], ['报价已发送，等待确认', 'quoted', 4]);
    const cleared = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/public-result`,
      headers,
      payload: { requestKey: randomUUID(), expectedRevision: 4, publicResult: '  ' },
    });
    assert.equal(cleared.json().data.publicResult, null);
    const detail = (await app.inject({ url: `/projects/${id}`, headers })).json().data;
    assert.deepEqual(detail.events[0].payload, { publicResult: null, revision: 5 });
    assert.deepEqual(detail.statusTransitions, ['following', 'won', 'lost', 'closed']);
  },
);
