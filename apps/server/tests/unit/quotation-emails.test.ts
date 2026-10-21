import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type pg from 'pg';
import { renderQuotationEmail, type QuotationEmail } from '../../src/modules/projects/quotation-emails.js';
import { quotationEmailMessages } from '../../src/modules/projects/quotation-email-messages.js';
import type { SavedQuotation } from '../../src/modules/projects/quotation.js';
import { deliverQuotationEmails } from '../../src/workers/quotation-emails.js';
import { MailDeliveryError, type MailMessage } from '../../src/infra/mailer.js';
import type { Logger } from '../../src/infra/logger.js';

const quotation: SavedQuotation = {
  quotationNo: 'QT-PJ-00000001',
  revision: 3,
  createdAt: '2026-10-21T06:00:00.000Z',
  createdBy: 'admin-1',
  currency: 'USD',
  currencyScale: 2,
  roundingMode: 'HALF_UP',
  priceBasis: 'excluded',
  validUntil: '2026-11-20',
  validityTimeZone: 'Asia/Shanghai',
  items: [
    {
      clientLineId: 'line-1',
      kind: 'material',
      name: '立柱',
      quantity: '2',
      pricingUnit: '件',
      unitPrice: '10',
      lineAmount: '20.00',
      differenceReason: '新增',
    },
  ],
  totalAmount: '20.00',
  completeness: 'ready',
  validationIssues: [],
  terms: '',
  inclusions: '<b>物料</b>',
  exclusions: ' ',
  changeReason: '首次报价',
};
const email: QuotationEmail = {
  id: 'quotation-email-1',
  projectId: 'project-1',
  recipient: 'Buyer@Example.com',
  locale: 'zh',
  attempts: 1,
  projectNo: 'PJ-00000001',
  schemeCode: 'S-001',
  contact: { name: '<i>客户</i>', email: 'Buyer@Example.com' },
  company: '展览公司',
  quotation,
};

test('quotation email summarises the revision, shows only filled customer sections and escapes input', () => {
  const zh = renderQuotationEmail(email);
  assert.equal(zh.subject, '报价单 · QT-PJ-00000001 r3');
  assert.ok(zh.text.includes('报价总额: USD 20.00'));
  assert.ok(zh.text.includes('税费口径: 不含税'));
  assert.ok(zh.text.includes('有效期至: 2026-11-20 (Asia/Shanghai)'));
  assert.ok(zh.text.includes('包含范围:'));
  assert.ok(!zh.text.includes('不包含范围'), 'blank sections are omitted');
  assert.ok(!zh.text.includes('条款说明'));
  assert.ok(zh.html.includes('&lt;b&gt;物料&lt;/b&gt;'));
  assert.ok(zh.html.includes('&lt;i&gt;客户&lt;/i&gt;'));
  assert.ok(!zh.html.includes('<b>物料'));
  const ar = renderQuotationEmail({ ...email, locale: 'ar' });
  assert.ok(ar.html.includes('dir="rtl"'));
  assert.ok(renderQuotationEmail({ ...email, locale: 'en' }).subject.startsWith('Quotation · '));
});

test('the attached workbook uses the customer locale', async () => {
  const sent: MailMessage[] = [];
  const database = {
    query: async (sql: string) => ({ rows: sql.includes('SET attempts') ? [{ ...email, locale: 'en' }] : [] }),
  } as unknown as Pick<pg.Pool, 'query'>;
  const log = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;
  await deliverQuotationEmails(database, async message => void sent.push(message), log);
  const workbook = new ExcelJS.Workbook();
  const content = sent[0]?.attachments?.[0]?.content;
  assert.ok(content);
  await workbook.xlsx.load(content as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.equal(workbook.getWorksheet('Quotation')?.getCell('A1').value, 'Quotation no.');
  assert.ok(sent[0]!.text.includes('Tax basis: Tax excluded'));
});

test('every quotation email locale is complete and keeps placeholders', () => {
  for (const [locale, messages] of Object.entries(quotationEmailMessages)) {
    for (const [key, value] of Object.entries(messages)) assert.ok(value.trim(), `${locale}.${key}`);
    assert.ok(messages.greeting.includes('{name}'), `${locale}.greeting`);
  }
});

test('delivery attaches the quotation workbook, dead-letters bad data and stops the batch on transient SMTP failures', async () => {
  const updates: { sql: string; values: unknown[] }[] = [];
  const claimed = [
    email,
    { ...email, id: 'quotation-email-2', quotation: { ...quotation, completeness: 'incomplete' as const } },
    { ...email, id: 'quotation-email-3' },
    { ...email, id: 'quotation-email-4' },
  ];
  const database = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('UPDATE project_quotation_emails e SET attempts')) return { rows: claimed };
      updates.push({ sql, values });
      return { rows: [] };
    },
  } as unknown as Pick<pg.Pool, 'query'>;
  const sent: MailMessage[] = [];
  const send = async (message: MailMessage) => {
    sent.push(message);
    if (sent.length === 2) throw new MailDeliveryError('SMTP_ECONNECTION', false);
  };
  const logs: unknown[] = [];
  const log = {
    info: (entry: unknown) => logs.push(entry),
    warn: (entry: unknown) => logs.push(entry),
    error: (entry: unknown) => logs.push(entry),
  } as unknown as Logger;
  assert.deepEqual(await deliverQuotationEmails(database, send, log), { delivered: 1, failed: 2, released: 1 });
  assert.equal(sent.length, 2, 'an unreachable SMTP server stops the batch');
  assert.equal(sent[0]!.to, 'Buyer@Example.com');
  const attachment = sent[0]!.attachments?.[0];
  assert.equal(attachment?.filename, 'PJ-00000001-quotation-r3.xlsx');
  assert.equal(attachment?.content.subarray(0, 2).toString(), 'PK', 'attachment is an xlsx (zip) file');
  assert.ok(sent[0]!.text.includes('税费口径: 不含税'));
  assert.ok(updates[0]!.sql.includes('SET delivered_at = now()'));
  assert.ok(updates[0]!.sql.includes("'quotation-email'"), 'delivery is recorded on the project timeline');
  // 报价单生成失败（不完整修订）不经过 SMTP，直接终态失败
  assert.deepEqual(updates[1]!.values.slice(0, 2), ['quotation-email-2', 'QUOTATION_INCOMPLETE']);
  assert.equal(updates[1]!.values[3], true);
  assert.deepEqual(updates[2]!.values.slice(0, 2), ['quotation-email-3', 'SMTP_ECONNECTION']);
  assert.equal(updates[2]!.values[3], false);
  assert.match(updates[3]!.sql, /attempts = GREATEST\(attempts - 1, 0\)/);
  assert.deepEqual(updates[3]!.values, [['quotation-email-4']]);
  assert.ok(!JSON.stringify(logs).includes('Buyer@Example.com'), 'logs must not contain recipient addresses');
});
