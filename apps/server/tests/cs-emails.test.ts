import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { logger } from '../src/infra/logger.js';
import { MailDeliveryError, type MailMessage } from '../src/infra/mailer.js';
import { claimConversation, openConversation } from '../src/modules/customer-service/conversations.js';
import type { Subject } from '../src/modules/customer-service/domain.js';
import { csEmailBackoffSeconds, renderCsEmail, type CsEmail, type EmailContent } from '../src/modules/customer-service/emails.js';
import { markCustomerRead, postAgentMessage, postCustomerMessage } from '../src/modules/customer-service/messages.js';
import { touchCustomer } from '../src/modules/customer-service/presence.js';
import { getSettings, offlineNotifyDelivery, settingsView, updateSettings } from '../src/modules/customer-service/settings.js';
import { issueVisitor } from '../src/modules/customer-service/visitors.js';
import { deliverCsEmails } from '../src/workers/cs-emails.js';
import { csTestPool, csTestRedis, seedAdmin, seedUser } from './cs-fixtures.js';

const email = (overrides: Partial<CsEmail> = {}): CsEmail => ({ id: 'e1', conversationId: 'c1', kind: 'reply_notice', recipient: 'buyer@example.com',
  locale: 'en', afterSeq: '0', attempts: 1, conversationNo: 'CS-00000001', deleted: false, ...overrides });
const content = (overrides: Partial<EmailContent> = {}): EmailContent => ({ lines: [], total: 0, customer: null, visitor: true, contexts: [],
  contactEmail: 'buyer@example.com', ...overrides });

test('reply notices use translations, cap three replies at 200 characters, escape HTML and link without credentials', () => {
  const lines = ['one', 'two', 'three', 'four'].map((body, index) => ({ seq: String(index + 1), body: `原文${body}`, translation: index === 3 ? null : `<b>${body}</b>${'x'.repeat(300)}` }));
  const rendered = renderCsEmail(email(), content({ lines: lines.slice(-3), total: 4 }), 'https://booth.example.com');
  assert.equal(rendered.subject, 'Customer service replied · CS-00000001');
  assert.match(rendered.text, /https:\/\/booth\.example\.com\/\?cs=open/);
  assert.match(rendered.text, /1 more replies/);
  assert.match(rendered.text, /原文four/, 'untranslated replies fall back to the original');
  assert.ok(!rendered.html.includes('<b>two</b>'));
  assert.ok(rendered.html.includes('&lt;b&gt;two&lt;/b&gt;'));
  assert.ok(rendered.text.split('\n').every(line => line.length <= 201));
  assert.doesNotMatch(rendered.text + rendered.html, /token|ticket|Bearer/i);
  const arabic = renderCsEmail(email({ locale: 'ar' }), content({ lines: lines.slice(0, 1), total: 1 }), 'https://booth.example.com');
  assert.match(arabic.html, /dir="rtl"/);
  assert.match(renderCsEmail(email(), content({ lines: lines.slice(0, 1), total: 1 }), 'https://x.test').html, /dir="ltr"/);
});

test('offline notices list every message with its translation, the customer and the contexts', () => {
  const rendered = renderCsEmail(email({ kind: 'offline_notice', locale: 'zh' }), content({
    lines: [{ seq: '5', body: 'Need a quote', translation: '需要报价' }, { seq: '6', body: 'Thanks', translation: null }], total: 2,
    contexts: ['S-001 方案 S-001', 'PJ-00000001'],
  }), 'https://x.test');
  assert.equal(rendered.subject, '客户留言 · CS-00000001');
  assert.match(rendered.text, /访客 · buyer@example\.com/);
  assert.match(rendered.text, /Need a quote\n译文: 需要报价\n\nThanks/);
  assert.match(rendered.text, /S-001 方案 S-001；PJ-00000001/);
  assert.deepEqual([1, 2, 3, 6, 7, 8].map(csEmailBackoffSeconds), [60, 120, 240, 1920, 3600, 3600]);
});

test('outbox merges offline messages, honours the 10-minute window, cancels read replies and retries failures',
  { skip: !process.env.CS_TEST_DATABASE_URL || !process.env.CS_TEST_REDIS_URL }, async t => {
    const pool = await csTestPool(t);
    const redis = csTestRedis(t);
    const agent = await seedAdmin(pool, ['customer-service.read', 'customer-service.reply', 'customer-service.settings']);
    const settings = await getSettings(pool);
    await updateSettings(pool, { ...settings, offlineNotifyEmails: ['ops@example.com', 'lead@example.com'], expectedRevision: settings.revision }, agent);
    const visitor: Subject = { kind: 'visitor', visitorId: (await issueVisitor(pool, 'en')).visitorId };
    const { conversation } = await openConversation(pool, redis, visitor, { entryPoint: 'floating' }, 'en');
    const offline = (body: string) => ({ clientMessageId: randomUUID(), body, kind: 'offline' as const, contactEmail: 'Buyer@Example.com' });
    await postCustomerMessage(pool, redis, visitor, conversation.id, offline('first'), 'en');
    await postCustomerMessage(pool, redis, visitor, conversation.id, offline('second'), 'en');
    const outbox = async () => (await pool.query(`SELECT kind, recipient, after_seq::int AS "afterSeq", covered_seq::int AS "coveredSeq",
      sent_at IS NOT NULL AS sent, cancelled_at IS NOT NULL AS cancelled, failed_at IS NOT NULL AS failed, due_at > now() + interval '1 minute' AS deferred, attempts
      FROM cs_email_outbox ORDER BY created_at, recipient`)).rows;
    assert.deepEqual((await outbox()).map(row => [row.kind, row.recipient, row.sent]), [
      ['offline_notice', 'lead@example.com', false], ['offline_notice', 'ops@example.com', false]]);
    assert.equal((await pool.query('SELECT contact_email FROM cs_conversations WHERE id=$1', [conversation.id])).rows[0].contact_email, 'buyer@example.com');

    const sent: MailMessage[] = [];
    let failNext: Error | null = null;
    const send = async (message: MailMessage) => { if (failNext) { const error = failNext; failNext = null; throw error; } sent.push(message); };
    assert.deepEqual(await deliverCsEmails(pool, redis, send, 'https://booth.example.com', logger), { delivered: 2, failed: 0 });
    assert.ok(sent.every(message => message.text.includes('first') && message.text.includes('second')));
    const lastSeq = (await pool.query("SELECT max(seq)::int AS seq FROM cs_messages WHERE kind='offline'")).rows[0].seq;
    assert.ok((await outbox()).every(row => row.sent && row.coveredSeq === lastSeq));

    await postCustomerMessage(pool, redis, visitor, conversation.id, offline('third'), 'en');
    const window = (await outbox()).filter(row => !row.sent);
    assert.deepEqual(window.map(row => [row.afterSeq, row.deferred]), [[lastSeq, true], [lastSeq, true]], 'next notice waits 10 minutes after the last one');
    await pool.query("UPDATE cs_email_outbox SET due_at=now() WHERE sent_at IS NULL");
    failNext = new MailDeliveryError('SMTP_EENVELOPE', true);
    assert.deepEqual(await deliverCsEmails(pool, redis, send, 'https://booth.example.com', logger), { delivered: 1, failed: 1 });
    assert.equal(sent.at(-1)!.text.includes('first'), false, 'later notices only carry new messages');
    assert.equal((await outbox()).filter(row => row.failed).length, 1, 'permanent failures stop retrying');
    const failedRecipient = (await pool.query("SELECT recipient FROM cs_email_outbox WHERE failed_at IS NOT NULL")).rows[0].recipient as string;
    const delivery = (await settingsView(pool)).offlineNotifyDelivery;
    assert.deepEqual(delivery.map(item => item.recipient), ['ops@example.com', 'lead@example.com'], 'delivery follows the configured order');
    for (const item of delivery) {
      if (item.recipient === failedRecipient) assert.deepEqual([item.status, item.lastErrorCode, item.pendingCount], ['failed', 'SMTP_EENVELOPE', 0]);
      else assert.deepEqual([item.status, item.lastErrorCode, item.lastFailedAt], ['sent', null, null]);
    }
    assert.deepEqual(await offlineNotifyDelivery(pool, ['nobody@example.com']), [{ recipient: 'nobody@example.com', status: 'idle', lastSentAt: null,
      lastFailedAt: null, lastErrorCode: null, pendingCount: 0 }]);
    await postCustomerMessage(pool, redis, visitor, conversation.id, offline('fourth'), 'en');
    const pendingFor = (await offlineNotifyDelivery(pool, [failedRecipient]))[0]!;
    assert.deepEqual([pendingFor.status, pendingFor.pendingCount], ['failed', 1], 'a newer pending notice does not hide the permanent failure');
    await pool.query("UPDATE cs_email_outbox SET attempts=1, last_error_code='SMTP_ETIMEDOUT' WHERE recipient<>$1 AND sent_at IS NULL AND failed_at IS NULL", [failedRecipient]);
    const retrying = (await offlineNotifyDelivery(pool, delivery.map(item => item.recipient).filter(recipient => recipient !== failedRecipient)))[0]!;
    assert.deepEqual([retrying.status, retrying.lastErrorCode, retrying.pendingCount], ['retrying', 'SMTP_ETIMEDOUT', 1]);
    await pool.query("UPDATE cs_email_outbox SET cancelled_at=now() WHERE kind='offline_notice' AND sent_at IS NULL AND failed_at IS NULL");

    const customer: Subject = { kind: 'user', userId: await seedUser(pool, 'Account@Example.com') };
    const chat = await openConversation(pool, redis, customer, { entryPoint: 'floating' }, 'de');
    await postCustomerMessage(pool, redis, customer, chat.conversation.id, { clientMessageId: randomUUID(), body: 'Hallo', kind: 'text' }, 'de');
    const viewer = { adminId: agent, supervise: false };
    await claimConversation(pool, redis, viewer, chat.conversation.id);
    const reply = async (body: string) => postAgentMessage(pool, redis, viewer, chat.conversation.id, { clientMessageId: randomUUID(), body, kind: 'text' });
    await reply('您好');
    await reply('还在吗');
    const replies = async () => (await pool.query(`SELECT recipient, locale, sent_at IS NOT NULL AS sent, cancelled_at IS NOT NULL AS cancelled
      FROM cs_email_outbox WHERE kind='reply_notice' ORDER BY created_at`)).rows;
    assert.deepEqual(await replies(), [{ recipient: 'account@example.com', locale: 'de', sent: false, cancelled: false }], 'replies merge into one pending notice');
    const last = await reply('最后一条');
    await markCustomerRead(pool, redis, customer, chat.conversation.id, last.message.seq);
    assert.deepEqual((await replies()).map(row => row.cancelled), [true], 'reading everything cancels the reminder');

    await reply('客户在线时不排队');
    await touchCustomer(redis, chat.conversation.id);
    await reply('仍然在线');
    assert.equal((await replies()).length, 2, 'only the reply sent while offline was queued');
    await pool.query("UPDATE cs_email_outbox SET due_at=now() WHERE kind='reply_notice' AND sent_at IS NULL AND cancelled_at IS NULL");
    assert.deepEqual(await deliverCsEmails(pool, redis, send, 'https://booth.example.com', logger), { delivered: 0, failed: 0 });
    assert.deepEqual((await replies()).map(row => row.cancelled), [true, true], 'customers back online are not emailed');
  });
