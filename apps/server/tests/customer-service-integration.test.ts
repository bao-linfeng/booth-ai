import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Redis } from 'ioredis';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { workbenchStream } from '../src/http/admin/customer-service/index.js';
import { customerStreamHeartbeat } from '../src/http/client/customer-service/index.js';
import { createSession, destroySession, encryptJwt } from '../src/infra/session.js';
import { requeueAgentConversations } from '../src/modules/customer-service/agents.js';
import {
  claimConversation, closeConversation, getConversationDetail, listConversations, openConversation, releaseConversation, sendContext, transferConversation,
} from '../src/modules/customer-service/conversations.js';
import type { Subject } from '../src/modules/customer-service/domain.js';
import { listAdminMessages, listCustomerMessages, markCustomerRead, postAgentMessage, postCustomerMessage } from '../src/modules/customer-service/messages.js';
import { setAway, touchAgent } from '../src/modules/customer-service/presence.js';
import { runRetention } from '../src/modules/customer-service/retention.js';
import { updateSettings } from '../src/modules/customer-service/settings.js';
import { issueVisitor, mergeVisitor, resolveVisitor } from '../src/modules/customer-service/visitors.js';
import { seedAiModel } from './ai-fixtures.js';
import { themeContextObjectKey } from '../src/modules/customer-service/contexts.js';
import { resolvePrincipal, revokeAccountSessions } from '../src/modules/identity/principal.js';
import { csTestPool, csTestRedis, seedAdmin, seedProject, seedScheme, seedThemeJob, seedUser } from './cs-fixtures.js';

const enabled = { skip: !process.env.CS_TEST_DATABASE_URL || !process.env.CS_TEST_REDIS_URL };
const text = (body: string) => ({ clientMessageId: randomUUID(), body, kind: 'text' as const });
const testConfig = () => loadConfig({
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only', CORS_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test',
});

test('opening is idempotent per subject, appends a card per context, never touches projects, and isolates other subjects (CS02/CS03/CS04/CS09)', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  const assignee = await seedAdmin(pool, ['projects.read', 'projects.follow-up']);
  await seedScheme(pool, 'S-001');
  await seedScheme(pool, 'S-DRAFT', 'draft');
  const user = await seedUser(pool);
  const other = await seedUser(pool);
  const visitorA = (await issueVisitor(pool, 'en')).visitorId;
  const visitorB = (await issueVisitor(pool, 'en')).visitorId;
  const userProject = await seedProject(pool, { userId: user }, assignee);
  const otherProject = await seedProject(pool, { userId: other }, assignee);
  const visitorProject = await seedProject(pool, { visitorId: visitorA }, assignee);
  const projectEvents = async () => (await pool.query('SELECT count(*)::int AS n FROM project_events')).rows[0].n;
  const projectsBefore = (await pool.query('SELECT id, customer_user_id, visitor_id, updated_at FROM projects ORDER BY id')).rows;
  const eventsBefore = await projectEvents();
  const subject: Subject = { kind: 'user', userId: user };

  const opened = await Promise.all(Array.from({ length: 10 }, () =>
    openConversation(pool, redis, subject, { context: { kind: 'project', projectId: userProject }, entryPoint: 'my_project' }, 'en')));
  assert.equal(opened.filter(item => item.created).length, 1);
  assert.equal(new Set(opened.map(item => item.conversation.id)).size, 1);
  const conversationId = opened[0]!.conversation.id;
  await openConversation(pool, redis, subject, { context: { kind: 'scheme', schemeCode: 'S-001' }, entryPoint: 'scheme_detail' }, 'en');
  const again = await openConversation(pool, redis, subject, { context: { kind: 'scheme', schemeCode: 'S-001' }, entryPoint: 'scheme_detail' }, 'en');
  assert.deepEqual(again.contexts.map(context => context.kind), ['project', 'scheme']);
  const project = again.contexts[0]!;
  assert.equal(project.kind === 'project' && project.snapshot.exhibitionName, 'IFA');
  assert.ok(!JSON.stringify(again.contexts).includes('secret-budget') && !JSON.stringify(again.contexts).includes('buyer@example.com'));
  // 每次带上下文打开都追加一张卡片（10 次项目 + 2 次方案），上下文记录按会话去重
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM cs_messages WHERE kind='context'")).rows[0].n, 12);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM cs_conversation_contexts')).rows[0].n, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM cs_conversations WHERE status<>'closed'")).rows[0].n, 1);
  assert.equal(await projectEvents(), eventsBefore);
  assert.deepEqual((await pool.query('SELECT id, customer_user_id, visitor_id, updated_at FROM projects ORDER BY id')).rows, projectsBefore);

  for (const context of [{ kind: 'project' as const, projectId: otherProject }, { kind: 'project' as const, projectId: visitorProject },
    { kind: 'project' as const, projectId: randomUUID() }, { kind: 'scheme' as const, schemeCode: 'S-DRAFT' }]) {
    await assert.rejects(openConversation(pool, redis, subject, { context, entryPoint: 'my_project' }, 'en'), { statusCode: 404, reason: 'CONTEXT_NOT_FOUND' });
  }
  const a: Subject = { kind: 'visitor', visitorId: visitorA };
  const b: Subject = { kind: 'visitor', visitorId: visitorB };
  const own = await openConversation(pool, redis, a, { context: { kind: 'project', projectId: visitorProject }, entryPoint: 'quote_receipt' }, 'en');
  await assert.rejects(openConversation(pool, redis, b, { context: { kind: 'project', projectId: visitorProject }, entryPoint: 'quote_receipt' }, 'en'),
    { reason: 'CONTEXT_NOT_FOUND' });
  for (const attempt of [
    () => postCustomerMessage(pool, redis, b, own.conversation.id, text('hi'), 'en'),
    () => markCustomerRead(pool, redis, b, own.conversation.id, 1),
    () => postCustomerMessage(pool, redis, a, conversationId, text('hi'), 'en'),
  ]) {
    const error = await attempt().then(() => null, (failure: Error & { statusCode?: number; reason?: string }) => failure);
    assert.equal(error?.statusCode, 404);
    assert.equal(error?.reason, 'CONVERSATION_NOT_FOUND');
    assert.ok(!error?.message.includes(own.conversation.id) && !error?.message.includes(conversationId));
  }
  assert.deepEqual((await listCustomerMessages(pool, b, { limit: 30 })).items, []);
});

test('context cards are resent on demand, reuse the snapshot record and only go to the subject\'s open conversation', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  await seedScheme(pool, 'S-RESEND');
  await seedScheme(pool, 'S-RESEND-DRAFT', 'draft');
  const subject: Subject = { kind: 'user', userId: await seedUser(pool) };
  const outsider: Subject = { kind: 'user', userId: await seedUser(pool) };
  const input = { context: { kind: 'scheme' as const, schemeCode: 'S-RESEND' }, entryPoint: 'scheme_detail' as const };
  const opened = await openConversation(pool, redis, subject, input, 'en');
  const conversationId = opened.conversation.id;

  const first = await sendContext(pool, redis, subject, conversationId, input, 'en');
  const second = await sendContext(pool, redis, subject, conversationId, input, 'en');
  assert.notEqual(first.message.id, second.message.id);
  assert.deepEqual([first.message.kind, first.message.context?.id, second.message.context?.id], ['context', opened.contexts[0]!.id, opened.contexts[0]!.id]);
  assert.equal(second.message.context?.kind === 'scheme' && second.message.context.snapshot.schemeCode, 'S-RESEND');
  assert.deepEqual((await listCustomerMessages(pool, subject, { limit: 30 })).items.map(item => item.kind), ['context', 'context', 'context']);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM cs_conversation_contexts WHERE conversation_id=$1', [conversationId])).rows[0].n, 1);

  await assert.rejects(sendContext(pool, redis, outsider, conversationId, input, 'en'), { statusCode: 404, reason: 'CONVERSATION_NOT_FOUND' });
  await assert.rejects(sendContext(pool, redis, subject, conversationId, { ...input, context: { kind: 'scheme', schemeCode: 'S-RESEND-DRAFT' } }, 'en'),
    { statusCode: 404, reason: 'CONTEXT_NOT_FOUND' });
  const supervisor = await seedAdmin(pool, ['customer-service.read', 'customer-service.reply', 'customer-service.supervise']);
  await closeConversation(pool, redis, { adminId: supervisor, supervise: true }, conversationId);
  await assert.rejects(sendContext(pool, redis, subject, conversationId, input, 'en'), { reason: 'CONVERSATION_CLOSED' });
});

test('scheme cards carry the selected theme rendering of the customer\'s own finished job and serve it by context id', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  await seedScheme(pool, 'S-THEME');
  await seedScheme(pool, 'S-OTHER');
  const userId = await seedUser(pool);
  const subject: Subject = { kind: 'user', userId };
  const theme = await seedThemeJob(pool, userId, 'S-THEME');
  const running = await seedThemeJob(pool, userId, 'S-THEME', 'running');
  const foreign = await seedThemeJob(pool, await seedUser(pool), 'S-THEME');
  const scheme = (themeJobId?: string, schemeCode = 'S-THEME') => ({ context: { kind: 'scheme' as const, schemeCode, themeJobId }, entryPoint: 'scheme_detail' as const });
  const opened = await openConversation(pool, redis, subject, scheme(), 'en');
  const conversationId = opened.conversation.id;

  const first = (await sendContext(pool, redis, subject, conversationId, scheme(theme.jobId), 'en')).message.context!;
  assert.equal(first.kind === 'scheme' && first.schemeCode, 'S-THEME');
  assert.equal(first.kind === 'scheme' && first.snapshot.themeResultId, theme.results[0]!.resultId);
  assert.notEqual(first.id, opened.contexts[0]!.id, 'a themed card does not reuse the plain scheme snapshot');
  assert.equal(await themeContextObjectKey(pool, first.id), theme.results[0]!.objectKey);
  await assert.rejects(themeContextObjectKey(pool, opened.contexts[0]!.id), { statusCode: 404, reason: 'CONTEXT_NOT_FOUND' });
  await assert.rejects(themeContextObjectKey(pool, randomUUID()), { reason: 'CONTEXT_NOT_FOUND' });

  // 改选后再发送：新卡片用此刻选定的那张，早先卡片的图不变
  await pool.query('UPDATE theme_jobs SET selected_result_id=$1 WHERE id=$2', [theme.results[1]!.resultId, theme.jobId]);
  const second = (await sendContext(pool, redis, subject, conversationId, scheme(theme.jobId), 'en')).message.context!;
  assert.equal(second.kind === 'scheme' && second.snapshot.themeResultId, theme.results[1]!.resultId);
  assert.equal(await themeContextObjectKey(pool, second.id), theme.results[1]!.objectKey);
  assert.equal(await themeContextObjectKey(pool, first.id), theme.results[0]!.objectKey);
  assert.equal((await sendContext(pool, redis, subject, conversationId, scheme(theme.jobId), 'en')).message.context!.id, second.id);
  const summary = (await pool.query(`SELECT ARRAY(SELECT x.snapshot->>'schemeCode' FROM cs_conversation_contexts x WHERE x.conversation_id=$1) AS codes`,
    [conversationId])).rows[0].codes;
  assert.deepEqual(summary, ['S-THEME', 'S-THEME', 'S-THEME']);

  for (const input of [scheme(foreign.jobId), scheme(running.jobId), scheme(randomUUID()), scheme(theme.jobId, 'S-OTHER')]) {
    await assert.rejects(sendContext(pool, redis, subject, conversationId, input, 'en'), { statusCode: 404, reason: 'CONTEXT_NOT_FOUND' });
  }
  const visitor: Subject = { kind: 'visitor', visitorId: (await issueVisitor(pool, 'en')).visitorId };
  await assert.rejects(openConversation(pool, redis, visitor, scheme(theme.jobId), 'en'), { reason: 'CONTEXT_NOT_FOUND' });

  const app = await buildApp(testConfig(), { database: async () => {}, redis: async () => {}, storage: async () => {} },
    { pool, redis, storage: { signDownload: async (key: string, expiresIn: number) => `http://localhost:19000/test/${key}?expires=${expiresIn}` } } as never);
  t.after(() => app.close());
  const cover = await app.inject({ url: `/api/v1/client/customer-service/contexts/${first.id}/theme-cover` });
  assert.equal(cover.statusCode, 302, cover.body);
  assert.equal(cover.headers.location, `http://localhost:19000/test/${theme.results[0]!.objectKey}?expires=300`);
  assert.equal(cover.headers['cache-control'], 'private, max-age=240');
  assert.equal((await app.inject({ url: `/api/v1/client/customer-service/contexts/${opened.contexts[0]!.id}/theme-cover` })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/v1/client/customer-service/contexts/not-a-uuid/theme-cover' })).statusCode, 400);
});

test('messages replay by clientMessageId, notes never reach the customer channel and Redis outages do not lose messages (CS08/CS09/CS12)', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  const agent = await seedAdmin(pool, ['customer-service.read', 'customer-service.reply'], 'Lily');
  const subject: Subject = { kind: 'visitor', visitorId: (await issueVisitor(pool, 'en')).visitorId };
  const { conversation } = await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en');
  const agentSubscriber = redis.duplicate();
  t.after(() => agentSubscriber.disconnect());
  const agentEvents: { type: string; conversationId: string; senderType?: string; kind?: string }[] = [];
  agentSubscriber.on('message', (_channel, payload) => agentEvents.push(JSON.parse(payload)));
  await agentSubscriber.subscribe('cs:agents');
  const input = text('hello');
  const first = await postCustomerMessage(pool, redis, subject, conversation.id, input, 'en');
  const replay = await postCustomerMessage(pool, redis, subject, conversation.id, input, 'en');
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.message.id, first.message.id);
  await assert.rejects(postCustomerMessage(pool, redis, subject, conversation.id, { ...input, body: 'changed' }, 'en'), { statusCode: 409, reason: 'IDEMPOTENCY_CONFLICT' });
  assert.ok(first.conversation.lastPublicSeq! >= first.message.seq);

  const subscriber = redis.duplicate();
  t.after(() => subscriber.disconnect());
  const received: { type: string; message?: { kind: string } }[] = [];
  subscriber.on('message', (_channel, payload) => received.push(JSON.parse(payload)));
  await subscriber.subscribe(`cs:conv:${conversation.id}`);
  const viewer = { adminId: agent, supervise: false };
  await claimConversation(pool, redis, viewer, conversation.id);
  await postAgentMessage(pool, redis, viewer, conversation.id, { ...text('internal only'), kind: 'note' });
  const reply = await postAgentMessage(pool, redis, viewer, conversation.id, text('hi there'));
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(received.some(event => event.type === 'conversation.updated'));
  assert.ok(received.every(event => event.message?.kind !== 'note'));
  assert.ok(received.some(event => event.type === 'message.created' && event.message?.kind === 'text'));
  // 工作台事件带发送者与消息类型，前端只对客户消息做新消息提醒（CS-B08）
  assert.deepEqual(agentEvents.filter(event => event.type === 'message.created' && event.conversationId === conversation.id)
    .map(event => [event.senderType, event.kind]), [['customer', 'text'], ['system', 'event'], ['agent', 'note'], ['agent', 'text']]);
  const timeline = await listCustomerMessages(pool, subject, { limit: 100 });
  assert.ok(timeline.items.every(item => !JSON.stringify(item).includes('internal only')));
  assert.deepEqual(timeline.items.map(item => item.kind), ['text', 'event', 'text']);
  assert.equal(timeline.items[1]!.eventParams?.agentName, 'Lily');
  assert.deepEqual((await listCustomerMessages(pool, subject, { after: first.message.seq, limit: 1 })).items.map(item => item.kind), ['event']);
  const older = await listCustomerMessages(pool, subject, { before: reply.message.seq, limit: 1 });
  assert.deepEqual([older.items.length, older.hasMore], [1, true]);
  assert.equal((await listAdminMessages(pool, viewer, conversation.id, { limit: 100 })).items.filter(item => item.kind === 'note').length, 1);

  const broken = { publish: async () => { throw new Error('ECONNREFUSED'); }, exists: async () => { throw new Error('ECONNREFUSED'); },
    zremrangebyscore: async () => { throw new Error('down'); } } as unknown as Redis;
  const offline = await postCustomerMessage(pool, broken, subject, conversation.id, text('while redis is down'), 'en');
  assert.equal(offline.created, true);
  const after = await listCustomerMessages(pool, subject, { after: reply.message.seq, limit: 10 });
  assert.deepEqual(after.items.map(item => item.body), ['while redis is down']);
  await postAgentMessage(pool, broken, viewer, conversation.id, text('reply while down'));
  assert.equal((await openConversation(pool, broken, subject, { entryPoint: 'floating' }, 'en')).agentsOnline, false);
});

test('claims are exclusive, release/transfer/close follow agent rules and supervision limits visibility (CS05/CS11/CS13)', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  const agentA = await seedAdmin(pool);
  const agentB = await seedAdmin(pool);
  const supervisor = await seedAdmin(pool, ['customer-service.read', 'customer-service.reply', 'customer-service.supervise']);
  const readOnly = await seedAdmin(pool, ['customer-service.read']);
  const a = { adminId: agentA, supervise: false };
  const b = { adminId: agentB, supervise: false };
  const boss = { adminId: supervisor, supervise: true };
  const subject: Subject = { kind: 'user', userId: await seedUser(pool, 'buyer@example.com') };
  const { conversation } = await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en');
  assert.equal((await listConversations(pool, a, { tab: 'queue', page: 1, pageSize: 20 })).total, 0, 'silent conversations stay out of the queue');
  await postCustomerMessage(pool, redis, subject, conversation.id, text('anyone?'), 'en');
  const queue = await listConversations(pool, a, { tab: 'queue', page: 1, pageSize: 20 });
  assert.equal(queue.counts.queue, 1);
  assert.equal(queue.items[0]!.unreadCount, 1);
  assert.equal(queue.items[0]!.lastMessagePreview, 'anyone?');

  const results = await Promise.allSettled([claimConversation(pool, redis, a, conversation.id), claimConversation(pool, redis, b, conversation.id)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.reason, 'CONVERSATION_ALREADY_CLAIMED');
  assert.equal(rejected.reason.statusCode, 409);
  const owner = results[0]!.status === 'fulfilled' ? a : b;
  const outsider = owner === a ? b : a;

  await assert.rejects(getConversationDetail(pool, outsider, conversation.id), { statusCode: 404 });
  await assert.rejects(listAdminMessages(pool, outsider, conversation.id, { limit: 10 }), { statusCode: 404 });
  await assert.rejects(listConversations(pool, outsider, { tab: 'all', page: 1, pageSize: 20 }), { statusCode: 403 });
  assert.equal((await listConversations(pool, boss, { tab: 'all', page: 1, pageSize: 20 })).total, 1);
  assert.equal((await getConversationDetail(pool, boss, conversation.id)).conversation.agentAdminId, owner.adminId);
  await assert.rejects(postAgentMessage(pool, redis, boss, conversation.id, text('not mine')), { reason: 'NOT_CONVERSATION_AGENT' });
  await postAgentMessage(pool, redis, boss, conversation.id, { ...text('supervisor note'), kind: 'note' });
  await assert.rejects(releaseConversation(pool, redis, outsider, conversation.id), { statusCode: 404 });
  await assert.rejects(claimConversation(pool, redis, { adminId: readOnly, supervise: false }, conversation.id), { reason: 'AGENT_UNAVAILABLE' });

  await assert.rejects(transferConversation(pool, redis, boss, conversation.id, { adminId: readOnly, reason: 'x' }), { reason: 'AGENT_UNAVAILABLE' });
  const moved = await transferConversation(pool, redis, boss, conversation.id, { adminId: outsider.adminId, reason: 'VIP 客户' });
  assert.equal(moved.conversation.agentAdminId, outsider.adminId);
  const customerView = await listCustomerMessages(pool, subject, { limit: 100 });
  assert.ok(!JSON.stringify(customerView).includes('VIP'), 'transfer reasons stay internal');
  await releaseConversation(pool, redis, outsider, conversation.id);
  assert.equal((await listConversations(pool, a, { tab: 'queue', page: 1, pageSize: 20 })).counts.queue, 1, 'released conversations re-enter the queue');
  await claimConversation(pool, redis, owner, conversation.id);

  // 撤销回复权限：不能再抢接，进行中的会话退回队列
  await pool.query("UPDATE admin_roles SET permission_codes=ARRAY['customer-service.read'] WHERE name=ANY((SELECT roles FROM admins WHERE id=$1)::text[])", [owner.adminId]);
  const second: Subject = { kind: 'user', userId: await seedUser(pool) };
  const next = await openConversation(pool, redis, second, { entryPoint: 'floating' }, 'en');
  await assert.rejects(claimConversation(pool, redis, owner, next.conversation.id), { statusCode: 409, reason: 'AGENT_UNAVAILABLE' });
  assert.equal(await requeueAgentConversations(pool, redis, owner.adminId), 1);
  const requeued = await getConversationDetail(pool, boss, conversation.id);
  assert.equal(requeued.conversation.status, 'queued');
  assert.equal((await listCustomerMessages(pool, subject, { limit: 100 })).items.at(-1)!.eventCode, 'agent_unavailable');

  await assert.rejects(closeConversation(pool, redis, outsider, conversation.id), { reason: 'NOT_CONVERSATION_AGENT' });
  await closeConversation(pool, redis, boss, conversation.id);
  await assert.rejects(postCustomerMessage(pool, redis, subject, conversation.id, text('late'), 'en'), { statusCode: 409, reason: 'CONVERSATION_CLOSED' });
  const reopened = await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en');
  assert.notEqual(reopened.conversation.id, conversation.id);
  assert.equal((await getConversationDetail(pool, boss, reopened.conversation.id)).history.length, 1);
});

test('agents online follows presence and away state', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  await redis.del('cs:presence');
  const agent = await seedAdmin(pool);
  const subject: Subject = { kind: 'user', userId: await seedUser(pool) };
  assert.equal((await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en')).agentsOnline, false);
  assert.equal(await touchAgent(redis, agent), true);
  assert.equal((await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en')).agentsOnline, true);
  await setAway(redis, agent, true);
  assert.equal(await touchAgent(redis, agent), false, 'heartbeats do not bring an away agent back online');
  assert.equal((await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en')).agentsOnline, false);
  await setAway(redis, agent, false);
  assert.equal((await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en')).agentsOnline, true);
  await redis.zadd('cs:presence', Date.now() - 1, agent);
  assert.equal((await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en')).agentsOnline, false, 'expired heartbeats are pruned');
});

test('SSE heartbeats revalidate the login session and latest permissions, narrowing supervision without reconnecting (CS-B04)', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  // 模拟一次新登录：Session 携带账户当前的 session_version
  const login = async (site: 'client' | 'admin', localId: string) => {
    const { sessionVersion } = (await pool.query(`SELECT session_version AS "sessionVersion" FROM ${site === 'client' ? 'users' : 'admins'} WHERE id=$1`,
      [localId])).rows[0];
    const token = await createSession(redis, { site, localId, externalUserId: 1, username: 'test', externalJwtCiphertext: encryptJwt('jwt', 'test-secret'),
      loginSource: 'password', sessionVersion }, 3600, Math.floor(Date.now() / 1000) + 3600);
    return resolvePrincipal(pool, redis, token, site);
  };
  const grant = (adminId: string, permissions: string[]) => pool.query(
    'UPDATE admin_roles r SET permission_codes=$2 FROM admins a WHERE a.id=$1 AND r.name=ANY(a.roles)', [adminId, permissions]);

  // 登录客户：登出（销毁 Session）或服务端撤销全部 Session 后，下一次心跳断流；未失效时续期客户在线
  const customer = await seedUser(pool);
  const subject: Subject = { kind: 'user', userId: customer };
  const conversationId = (await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en')).conversation.id;
  await redis.del(`cs:customer-presence:${conversationId}`);
  const loggedOut = await login('client', customer);
  const revoked = await login('client', customer);
  // 有效心跳顺带推送坐席在线状态，面板常开时也能切换排队 / 留言模式；断流的心跳不推送
  const sent: unknown[] = [];
  const send = (event: unknown) => { sent.push(event); };
  await redis.del('cs:presence');
  assert.equal(await customerStreamHeartbeat(pool, redis, conversationId, subject, loggedOut, send), true);
  assert.equal(await redis.exists(`cs:customer-presence:${conversationId}`), 1);
  await redis.zadd('cs:presence', Date.now() + 45_000, await seedAdmin(pool));
  assert.equal(await customerStreamHeartbeat(pool, redis, conversationId, subject, loggedOut, send), true);
  assert.deepEqual(sent, [{ type: 'presence', agentsOnline: false }, { type: 'presence', agentsOnline: true }]);
  await destroySession(redis, loggedOut.token);
  assert.equal(await customerStreamHeartbeat(pool, redis, conversationId, subject, loggedOut, send), false, 'logged-out sessions stop streaming');
  assert.equal(await customerStreamHeartbeat(pool, redis, conversationId, subject, revoked, send), true);
  await revokeAccountSessions(pool, 'client', customer);
  assert.equal(await customerStreamHeartbeat(pool, redis, conversationId, subject, revoked, send), false, 'revoked sessions stop streaming');
  assert.equal(await customerStreamHeartbeat(pool, redis, conversationId, subject, null, send), false);
  assert.equal(sent.length, 3, 'rejected heartbeats push nothing');
  const visitor: Subject = { kind: 'visitor', visitorId: (await issueVisitor(pool, 'en')).visitorId };
  const visitorConversation = (await openConversation(pool, redis, visitor, { entryPoint: 'floating' }, 'en')).conversation.id;
  assert.equal(await customerStreamHeartbeat(pool, redis, visitorConversation, visitor, null, send), true);
  await mergeVisitor(pool, redis, await seedUser(pool), visitor.visitorId);
  assert.equal(await customerStreamHeartbeat(pool, redis, visitorConversation, visitor, null, send), false, 'merged visitor tokens stop streaming');

  // 主管：撤销 supervise 但保留 read + reply 后，旧流在下一次心跳后只放行自己与队列的事件；重新连接按最新权限计算
  const supervisor = await seedAdmin(pool, ['customer-service.read', 'customer-service.reply', 'customer-service.supervise']);
  const other = await seedAdmin(pool);
  const event = (agentAdminId: string | null) => JSON.stringify({ type: 'queue.changed', conversationId, status: 'active', agentAdminId });
  const supervising = workbenchStream(pool, redis, await login('admin', supervisor), true);
  assert.deepEqual([supervising.visible(event(other)), supervising.visible(event(supervisor)), supervising.visible(event(null))], [true, true, true]);
  await grant(supervisor, ['customer-service.read', 'customer-service.reply']);
  assert.equal(await supervising.heartbeat(), true, 'agents keep streaming after losing supervision');
  assert.deepEqual([supervising.visible(event(other)), supervising.visible(event(supervisor)), supervising.visible(event(null))], [false, true, true]);
  assert.ok(await redis.zscore('cs:presence', supervisor), 'the heartbeat still renews agent presence');
  assert.equal(workbenchStream(pool, redis, await login('admin', supervisor), true).visible(event(other)), false);
  await grant(supervisor, ['customer-service.read', 'customer-service.reply', 'customer-service.supervise']);
  assert.equal(await supervising.heartbeat(), true);
  assert.equal(supervising.visible(event(other)), true, 'regranted supervision widens the scope again');

  // 只读连接：撤销 Session 或失去 read 后断流
  const reader = await seedAdmin(pool, ['customer-service.read']);
  const readerSession = await login('admin', reader);
  const reading = workbenchStream(pool, redis, readerSession, false);
  assert.equal(await reading.heartbeat(), true);
  assert.equal(await redis.zscore('cs:presence', reader), null, 'read-only connections never count as online agents');
  await revokeAccountSessions(pool, 'admin', reader);
  assert.equal(await reading.heartbeat(), false, 'revoked read-only sessions stop streaming');
  const demoted = workbenchStream(pool, redis, await login('admin', reader), false);
  await grant(reader, ['projects.read']);
  assert.equal(await demoted.heartbeat(), false, 'losing customer-service.read stops streaming');

  // 坐席：Session 失效只断流，不退回会话（可能仍在其他终端在线）；失去坐席资格时退回会话
  await claimConversation(pool, redis, { adminId: other, supervise: false }, conversationId);
  const otherSession = await login('admin', other);
  await destroySession(redis, otherSession.token);
  assert.equal(await workbenchStream(pool, redis, otherSession, true).heartbeat(), false);
  assert.equal((await pool.query('SELECT agent_admin_id FROM cs_conversations WHERE id=$1', [conversationId])).rows[0].agent_admin_id, other);
  const agentStream = workbenchStream(pool, redis, await login('admin', other), true);
  await grant(other, ['customer-service.read']);
  assert.equal(await agentStream.heartbeat(), false);
  assert.deepEqual((await pool.query('SELECT status, agent_admin_id FROM cs_conversations WHERE id=$1', [conversationId])).rows[0],
    { status: 'queued', agent_admin_id: null });
  assert.equal(await redis.zscore('cs:presence', other), null);
});

test('visitor merge keeps the newer open conversation, closes the other and invalidates the token without moving projects (CS03)', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  const assignee = await seedAdmin(pool, ['projects.read', 'projects.follow-up']);
  const user = await seedUser(pool);
  const issued = await issueVisitor(pool, 'ja');
  const visitor: Subject = { kind: 'visitor', visitorId: issued.visitorId };
  const project = await seedProject(pool, { visitorId: issued.visitorId }, assignee);
  const older = await openConversation(pool, redis, { kind: 'user', userId: user }, { entryPoint: 'floating' }, 'en');
  await postCustomerMessage(pool, redis, { kind: 'user', userId: user }, older.conversation.id, text('old'), 'en');
  await pool.query("UPDATE cs_conversations SET last_message_at=now() - interval '1 hour' WHERE id=$1", [older.conversation.id]);
  const newer = await openConversation(pool, redis, visitor, { context: { kind: 'project', projectId: project }, entryPoint: 'quote_receipt' }, 'ja');
  await postCustomerMessage(pool, redis, visitor, newer.conversation.id, text('new'), 'ja');
  assert.equal(await resolveVisitor(pool, issued.visitorToken), issued.visitorId);

  assert.equal(await mergeVisitor(pool, redis, user, issued.visitorId), 1);
  const rows = (await pool.query('SELECT id, status, close_reason, customer_user_id, visitor_id, origin_visitor_id FROM cs_conversations')).rows;
  const kept = rows.find(row => row.id === newer.conversation.id)!;
  assert.deepEqual([kept.status, kept.customer_user_id, kept.visitor_id, kept.origin_visitor_id], ['queued', user, null, issued.visitorId]);
  assert.deepEqual(rows.filter(row => row.id === older.conversation.id).map(row => [row.status, row.close_reason]), [['closed', 'merged']]);
  assert.equal(await resolveVisitor(pool, issued.visitorToken), null);
  assert.deepEqual((await pool.query('SELECT customer_user_id, visitor_id FROM projects WHERE id=$1', [project])).rows[0], { customer_user_id: null, visitor_id: issued.visitorId });
  const timeline = await listCustomerMessages(pool, { kind: 'user', userId: user }, { limit: 100 });
  assert.ok(timeline.items.some(item => item.eventCode === 'merged'));
  assert.ok(timeline.items.some(item => item.body === 'new'), 'merged history stays visible to the user');
  assert.equal(await mergeVisitor(pool, redis, user, issued.visitorId), 0);
});

test('translation rows are created only when enabled, assigned and languages differ (CS07)', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  const agent = await seedAdmin(pool);
  const viewer = { adminId: agent, supervise: false };
  const subject: Subject = { kind: 'user', userId: await seedUser(pool) };
  const { conversation } = await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'ja');
  const pendingFor = async (messageId: string) => (await pool.query('SELECT target_locale FROM cs_message_translations WHERE message_id=$1', [messageId])).rows.map(row => row.target_locale);
  const unassigned = await postCustomerMessage(pool, redis, subject, conversation.id, text('こんにちは'), 'ja');
  assert.deepEqual(await pendingFor(unassigned.message.id), [], 'no model assigned');
  await seedAiModel(pool, { protocol: 'openai', purpose: 'cs_translation' });
  const customer = await postCustomerMessage(pool, redis, subject, conversation.id, text('見積もりは?'), 'ja');
  assert.deepEqual(await pendingFor(customer.message.id), ['zh']);
  await claimConversation(pool, redis, viewer, conversation.id);
  const agentReply = await postAgentMessage(pool, redis, viewer, conversation.id, text('您好'));
  assert.deepEqual(await pendingFor(agentReply.message.id), ['ja']);
  assert.deepEqual(agentReply.message.translations, [{ locale: 'ja', status: 'pending', body: null }]);
  const note = await postAgentMessage(pool, redis, viewer, conversation.id, { ...text('备注'), kind: 'note' });
  assert.deepEqual(await pendingFor(note.message.id), []);
  const sameLanguage = await postCustomerMessage(pool, redis, subject, conversation.id, text('你好'), 'zh');
  assert.deepEqual(await pendingFor(sameLanguage.message.id), []);
  const current = (await pool.query('SELECT revision FROM cs_settings')).rows[0].revision;
  await updateSettings(pool, { translationEnabled: false, agentLocale: 'zh', offlineNotifyEmails: [], replyEmailEnabled: true, expectedRevision: current }, agent);
  await assert.rejects(updateSettings(pool, { translationEnabled: true, agentLocale: 'zh', offlineNotifyEmails: [], replyEmailEnabled: true, expectedRevision: current }, agent),
    { statusCode: 409, reason: 'REVISION_CONFLICT' });
  const disabled = await postCustomerMessage(pool, redis, subject, conversation.id, text('翻訳なし'), 'ja');
  assert.deepEqual(await pendingFor(disabled.message.id), []);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM admin_audit_logs WHERE action='cs_settings.update'")).rows[0].n, 1);
});

test('retention logically deletes six-month-old data from every listing (CS10)', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  const agent = await seedAdmin(pool, ['customer-service.read', 'customer-service.reply', 'customer-service.supervise']);
  const boss = { adminId: agent, supervise: true };
  const issued = await issueVisitor(pool, 'en');
  const subject: Subject = { kind: 'visitor', visitorId: issued.visitorId };
  const { conversation } = await openConversation(pool, redis, subject, { entryPoint: 'floating' }, 'en');
  await postCustomerMessage(pool, redis, subject, conversation.id, text('old question'), 'en');
  await closeConversation(pool, redis, boss, conversation.id);
  const fresh = await openConversation(pool, redis, { kind: 'user', userId: await seedUser(pool) }, { entryPoint: 'floating' }, 'en');
  await pool.query("UPDATE cs_messages SET created_at=now() - interval '7 months' WHERE conversation_id=$1", [conversation.id]);
  await pool.query("UPDATE cs_conversations SET last_message_at=now() - interval '7 months', created_at=now() - interval '7 months' WHERE id=$1", [conversation.id]);
  await pool.query("UPDATE cs_visitors SET last_seen_at=now() - interval '7 months' WHERE id=$1", [issued.visitorId]);

  assert.deepEqual(await runRetention(pool), { messages: 2, conversations: 1, visitors: 1 });
  assert.deepEqual(await runRetention(pool), { messages: 0, conversations: 0, visitors: 0 });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM cs_messages WHERE deleted_at IS NOT NULL')).rows[0].n, 2);
  assert.equal(await resolveVisitor(pool, issued.visitorToken), null);
  assert.deepEqual((await listCustomerMessages(pool, subject, { limit: 100 })).items, []);
  assert.deepEqual((await listConversations(pool, boss, { tab: 'all', page: 1, pageSize: 20 })).items.map(item => item.id), [fresh.conversation.id]);
  await assert.rejects(getConversationDetail(pool, boss, conversation.id), { statusCode: 404 });
});

test('HTTP: visitor tokens, isolation, rate limits and admin permissions (CS09/CS11)', enabled, async t => {
  const pool = await csTestPool(t);
  const redis = csTestRedis(t);
  const config = testConfig();
  // 本地重复运行时清掉上一轮遗留的限流计数（标准检查每次都会清空测试 Redis 库）
  for (const key of await redis.keys('rate:client:cs*')) await redis.del(key);
  const app = await buildApp(config, { database: async () => {}, redis: async () => {}, storage: async () => {} }, { pool, redis, storage: {} } as never);
  t.after(() => app.close());
  const session = async (site: 'client' | 'admin', localId: string) => createSession(redis, { site, localId, externalUserId: 1, username: 'test',
    externalJwtCiphertext: encryptJwt('jwt', config.sessionSecret), loginSource: 'password', sessionVersion: 1 }, 3600, Math.floor(Date.now() / 1000) + 3600);
  const base = '/api/v1/client/customer-service';
  // 访客令牌只经 HttpOnly Cookie 下发，响应体不含令牌；之后的请求回传 Cookie 并带 X-CS-Visitor 头
  const issue = async () => {
    const response = await app.inject({ method: 'POST', url: `${base}/visitors`, headers: { 'x-forwarded-for': randomUUID() } });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(Object.keys(response.json().data), ['visitorId']);
    const cookie = String(response.headers['set-cookie']);
    assert.match(cookie, /^booth_cs_visitor=[A-Za-z0-9_-]{43}; Path=\/api\/v1\/client; Max-Age=\d+; HttpOnly; SameSite=Lax$/);
    return { visitorId: response.json().data.visitorId as string, headers: { cookie: cookie.split(';')[0]!, 'x-cs-visitor': '1' } };
  };

  assert.equal((await app.inject({ url: `${base}/conversations/current` })).json().error.reason, 'VISITOR_REQUIRED');
  assert.equal((await app.inject({ url: `${base}/conversations/current`, headers: { cookie: `booth_cs_visitor=${'x'.repeat(43)}`, 'x-cs-visitor': '1' } })).statusCode, 401);
  const a = await issue();
  const b = await issue();
  assert.equal((await app.inject({ url: `${base}/conversations/current`, headers: { cookie: a.headers.cookie } })).json().error.reason, 'VISITOR_REQUIRED',
    'the cookie is ignored without the X-CS-Visitor header (CSRF)');
  assert.equal((await app.inject({ url: `${base}/conversations/current`, headers: { 'x-visitor-token': a.headers.cookie.split('=')[1]! } })).statusCode, 401,
    'the legacy token header is no longer accepted');
  const reissued = await app.inject({ method: 'POST', url: `${base}/visitors`, headers: { ...a.headers, 'x-forwarded-for': randomUUID() } });
  assert.deepEqual([reissued.statusCode, reissued.json().data.visitorId], [200, a.visitorId], 'issuing with a valid cookie reuses the visitor');
  assert.equal(String(reissued.headers['set-cookie']).split(';')[0], a.headers.cookie);
  const openA = await app.inject({ method: 'POST', url: `${base}/conversations`, headers: a.headers, payload: { entryPoint: 'floating' } });
  assert.equal(openA.statusCode, 201, openA.body);
  assert.equal(openA.headers['cache-control'], 'private, no-store');
  const conversationId = openA.json().data.conversation.id;
  assert.equal((await app.inject({ method: 'POST', url: `${base}/conversations`, headers: a.headers, payload: { entryPoint: 'floating' } })).statusCode, 200);
  const foreign = await app.inject({ method: 'POST', url: `${base}/conversations/${conversationId}/messages`, headers: b.headers,
    payload: text('peek') });
  assert.equal(foreign.statusCode, 404);
  assert.ok(!foreign.body.includes(conversationId));
  assert.equal((await app.inject({ method: 'POST', url: `${base}/conversations/${conversationId}/events-ticket`, headers: b.headers })).statusCode, 404);
  const ticket = (await app.inject({ method: 'POST', url: `${base}/conversations/${conversationId}/events-ticket`, headers: a.headers })).json().data.ticket;
  assert.deepEqual(JSON.parse((await redis.get(`cs-events-ticket:${ticket}`))!), { subject: conversationId, visitorId: a.visitorId });
  const offline = await app.inject({ method: 'POST', url: `${base}/conversations/${conversationId}/messages`, headers: a.headers,
    payload: { ...text('leave a note'), kind: 'offline' } });
  assert.equal(offline.json().error.reason, 'CONTACT_EMAIL_REQUIRED');
  const statuses: number[] = [];
  for (let n = 0; n < 11; n++) {
    statuses.push((await app.inject({ method: 'POST', url: `${base}/conversations/${conversationId}/messages`, headers: a.headers,
      payload: text(`message ${n}`) })).statusCode);
  }
  assert.deepEqual([statuses.filter(status => status === 201).length, statuses.at(-1)], [9, 429], 'the offline attempt also counted towards the per-visitor budget');
  const reopen = (payload: object) => app.inject({ method: 'POST', url: `${base}/conversations`, headers: a.headers, payload });
  assert.equal((await reopen({ entryPoint: 'scheme_detail', context: { kind: 'scheme', schemeCode: 'S-ANY' } })).statusCode, 429,
    'opening with a context appends a card and shares the message budget');
  assert.equal((await reopen({ entryPoint: 'floating' })).statusCode, 200, 'opening without a context is not limited');

  const agent = await seedAdmin(pool);
  const supervisor = await seedAdmin(pool, ['customer-service.read', 'customer-service.reply', 'customer-service.supervise', 'customer-service.settings']);
  const agentHeaders = { authorization: `Bearer ${await session('admin', agent)}` };
  const supervisorHeaders = { authorization: `Bearer ${await session('admin', supervisor)}` };
  const admin = '/api/v1/admin/customer-service';
  const queue = await app.inject({ url: `${admin}/conversations?tab=queue`, headers: agentHeaders });
  assert.equal(queue.json().data?.counts.queue, 1, queue.body);
  assert.equal((await app.inject({ url: `${admin}/conversations?tab=all`, headers: agentHeaders })).statusCode, 403);
  assert.equal((await app.inject({ url: `${admin}/agents`, headers: agentHeaders })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${admin}/conversations/${conversationId}/transfer`, headers: agentHeaders, payload: { reason: 'x' } })).statusCode, 403);
  const settings = (await app.inject({ url: `${admin}/settings`, headers: agentHeaders })).json().data;
  assert.equal(settings.translationModelAssigned, false);
  const update = { translationEnabled: true, agentLocale: 'zh', offlineNotifyEmails: ['Ops@Example.com'], replyEmailEnabled: true, expectedRevision: settings.revision };
  assert.equal((await app.inject({ method: 'PUT', url: `${admin}/settings`, headers: agentHeaders, payload: update })).statusCode, 403);
  const saved = await app.inject({ method: 'PUT', url: `${admin}/settings`, headers: supervisorHeaders, payload: update });
  assert.deepEqual(saved.json().data.offlineNotifyEmails, ['ops@example.com']);
  assert.deepEqual(saved.json().data.offlineNotifyDelivery.map((item: { recipient: string; status: string }) => [item.recipient, item.status]),
    [['ops@example.com', 'idle']]);
  assert.equal((await app.inject({ method: 'POST', url: `${admin}/conversations/${conversationId}/claim`, headers: agentHeaders })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${admin}/conversations/${conversationId}/claim`, headers: supervisorHeaders })).json().error.reason,
    'CONVERSATION_ALREADY_CLAIMED');
  const agents = (await app.inject({ url: `${admin}/agents`, headers: supervisorHeaders })).json().data;
  assert.deepEqual(agents.map((item: { adminId: string; activeCount: number }) => [item.adminId, item.activeCount]).sort(),
    [[agent, 1], [supervisor, 0]].sort());
  const posted = await app.inject({ method: 'POST', url: `${admin}/conversations/${conversationId}/messages`, headers: agentHeaders, payload: text('hello visitor') });
  assert.equal(posted.statusCode, 201, posted.body);
  const timeline = (await app.inject({ url: `${base}/messages?limit=100`, headers: a.headers })).json().data.items;
  assert.equal(timeline.at(-1).body, 'hello visitor');
  assert.equal((await app.inject({ url: `${base}/messages?before=1&after=2`, headers: a.headers })).statusCode, 400);

  // 登录后合并：读取 Cookie 中的访客令牌，合并后清除 Cookie，令牌随即失效
  const customer = await seedUser(pool);
  const clientHeaders = { authorization: `Bearer ${await session('client', customer)}` };
  const withoutHeader = await app.inject({ method: 'POST', url: `${base}/visitors/merge`, headers: { ...clientHeaders, cookie: a.headers.cookie } });
  assert.equal(withoutHeader.json().data.mergedConversations, 0, 'merge also requires the X-CS-Visitor header');
  assert.equal(withoutHeader.headers['set-cookie'], undefined, 'an unread cookie is left alone');
  // 合并事务失败：Cookie 保留、访客仍可访问原会话，重试后完成合并且只归属一次
  await pool.query(`CREATE FUNCTION reject_visitor_merge() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected merge failure'; END $$;
    CREATE TRIGGER reject_visitor_merge BEFORE UPDATE OF merged_user_id ON cs_visitors
    FOR EACH ROW WHEN (NEW.id = '${a.visitorId}') EXECUTE FUNCTION reject_visitor_merge()`);
  try {
    const failed = await app.inject({ method: 'POST', url: `${base}/visitors/merge`, headers: { ...clientHeaders, ...a.headers } });
    assert.equal(failed.statusCode, 500, failed.body);
    assert.equal(failed.headers['set-cookie'], undefined, 'a failed merge keeps the visitor cookie');
  } finally {
    await pool.query('DROP TRIGGER reject_visitor_merge ON cs_visitors; DROP FUNCTION reject_visitor_merge()');
  }
  assert.equal((await app.inject({ url: `${base}/conversations/current`, headers: a.headers })).json().data.conversation.id, conversationId,
    'the visitor still reaches its conversation after a failed merge');
  const merged = await app.inject({ method: 'POST', url: `${base}/visitors/merge`, headers: { ...clientHeaders, ...a.headers } });
  assert.equal(merged.json().data.mergedConversations, 1, merged.body);
  assert.match(String(merged.headers['set-cookie']), /^booth_cs_visitor=; Path=\/api\/v1\/client; Max-Age=0; HttpOnly; SameSite=Lax$/);
  // 响应丢失后前端再次重试：令牌已失效，返回 0 并清除 Cookie，不会重复归属
  const repeated = await app.inject({ method: 'POST', url: `${base}/visitors/merge`, headers: { ...clientHeaders, ...a.headers } });
  assert.equal(repeated.json().data.mergedConversations, 0);
  assert.match(String(repeated.headers['set-cookie']), /Max-Age=0/);
  assert.equal((await app.inject({ url: `${base}/conversations/current`, headers: a.headers })).json().error.reason, 'VISITOR_REQUIRED');
  assert.equal((await app.inject({ url: `${base}/conversations/current`, headers: clientHeaders })).json().data.conversation.id, conversationId);
});
