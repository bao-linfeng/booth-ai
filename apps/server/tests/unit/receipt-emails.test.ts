import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { renderReceiptEmail, RECEIPT_EMAIL_MAX_ATTEMPTS, type ReceiptEmail } from '../../src/modules/projects/receipt-emails.js';
import { receiptEmailMessages } from '../../src/modules/projects/receipt-email-messages.js';
import { deliverReceiptEmails } from '../../src/workers/receipt-emails.js';
import { MailDeliveryError, type MailMessage } from '../../src/infra/mailer.js';
import type { Logger } from '../../src/infra/logger.js';

const email: ReceiptEmail = {
  id: 'receipt-1',
  projectId: 'project-1',
  recipient: 'Visitor@Example.com',
  locale: 'zh',
  accountBound: false,
  attempts: 1,
  projectNo: 'PJ-00000001',
  requestNo: 'QR-ABC',
  sourceType: 'quote_request',
  contactName: '<b>访客</b>',
  exhibition: { name: '测试展会', city: '上海', startDate: '2026-11-10', endDate: '2026-11-12' },
  schemeName: '标准展台',
  schemeCode: 'S-001',
};

test('receipt email links guests to sign-in and account holders to the project, escaping customer input', () => {
  const guest = renderReceiptEmail(email, 'https://booth.example.test');
  assert.equal(guest.subject, '申请已受理 · PJ-00000001');
  assert.ok(guest.text.includes('https://booth.example.test/auth/sign-in?redirect=%2Fmy-projects'));
  assert.ok(guest.text.includes('Visitor@Example.com'));
  assert.ok(guest.text.includes('标准展台 (S-001)'));
  assert.ok(guest.html.includes('&lt;b&gt;访客&lt;/b&gt;'));
  assert.ok(!guest.html.includes('<b>访客'));
  const member = renderReceiptEmail(
    { ...email, accountBound: true, sourceType: 'manual_request', schemeCode: null, schemeName: null, exhibition: null },
    'https://booth.example.test',
  );
  assert.ok(member.text.includes('https://booth.example.test/my-projects/project-1'));
  assert.ok(member.text.includes('人工需求'));
  assert.ok(!member.text.includes('方案:'));
  assert.ok(renderReceiptEmail({ ...email, locale: 'ar' }, 'https://booth.example.test').html.includes('dir="rtl"'));
});

test('every receipt email locale is complete and keeps placeholders', () => {
  for (const [locale, messages] of Object.entries(receiptEmailMessages)) {
    for (const [key, value] of Object.entries(messages)) assert.ok(value.trim(), `${locale}.${key}`);
    assert.ok(messages.greeting.includes('{name}'), `${locale}.greeting`);
    assert.ok(messages.viewGuest.includes('{email}'), `${locale}.viewGuest`);
  }
});

test('delivery completes sent emails, dead-letters permanent rejections and stops the batch on transient failures', async () => {
  const updates: { sql: string; values: unknown[] }[] = [];
  const claimed = [email, { ...email, id: 'receipt-2' }, { ...email, id: 'receipt-3' }, { ...email, id: 'receipt-4' }];
  const database = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('UPDATE project_receipt_emails r SET attempts')) return { rows: claimed };
      updates.push({ sql, values });
      return { rows: [] };
    },
  } as unknown as Pick<pg.Pool, 'query'>;
  const sent: MailMessage[] = [];
  const send = async (message: MailMessage) => {
    sent.push(message);
    if (sent.length === 2) throw new MailDeliveryError('SMTP_EENVELOPE', true);
    if (sent.length === 3) throw new MailDeliveryError('SMTP_ECONNECTION', false);
  };
  const logs: unknown[] = [];
  const log = {
    info: (entry: unknown) => logs.push(entry),
    warn: (entry: unknown) => logs.push(entry),
    error: (entry: unknown) => logs.push(entry),
  } as unknown as Logger;
  assert.deepEqual(await deliverReceiptEmails(database, send, 'https://booth.example.test', log), { delivered: 1, failed: 2, released: 1 });
  assert.equal(sent.length, 3, 'an unreachable SMTP server stops the batch');
  assert.equal(sent[0]!.to, 'Visitor@Example.com');
  assert.ok(updates[0]!.sql.includes('SET delivered_at = now()'));
  assert.deepEqual(updates[1]!.values.slice(0, 2), ['receipt-2', 'SMTP_EENVELOPE']);
  assert.equal(updates[1]!.values[3], true);
  assert.deepEqual(updates[2]!.values.slice(0, 2), ['receipt-3', 'SMTP_ECONNECTION']);
  assert.equal(updates[2]!.values[3], 1 >= RECEIPT_EMAIL_MAX_ATTEMPTS);
  assert.match(updates[3]!.sql, /attempts = GREATEST\(attempts - 1, 0\)/, 'unsent emails get their lease and attempt back');
  assert.deepEqual(updates[3]!.values, [['receipt-4']]);
  assert.ok(!JSON.stringify(logs).includes('Visitor@Example.com'), 'logs must not contain recipient addresses');
});

test('delivery only starts an email that can finish inside the claim lease', async () => {
  const claimed = [email, { ...email, id: 'receipt-2' }, { ...email, id: 'receipt-3' }];
  const released: unknown[] = [];
  const database = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('UPDATE project_receipt_emails r SET attempts')) return { rows: claimed };
      if (sql.includes('GREATEST(attempts - 1, 0)')) released.push(values[0]);
      return { rows: [] };
    },
  } as unknown as Pick<pg.Pool, 'query'>;
  let clock = 0;
  // Each send takes 70 seconds: with a 120-second lease, a 45-second worst case and a 10-second margin a second one would overrun.
  const send = async () => {
    clock += 70_000;
  };
  const log = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;
  assert.deepEqual(await deliverReceiptEmails(database, send, 'https://booth.example.test', log, () => clock), {
    delivered: 1,
    failed: 0,
    released: 2,
  });
  assert.deepEqual(released, [['receipt-2', 'receipt-3']]);
});
