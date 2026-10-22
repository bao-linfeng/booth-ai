import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { leasedOutbox } from '../../src/infra/leased-outbox.js';
import type { Logger } from '../../src/infra/logger.js';
import { MailDeliveryError } from '../../src/infra/mailer.js';
import { deliverLeased, mailFailure, skip } from '../../src/workers/leased-batch.js';

function recordingDatabase() {
  const queries: { sql: string; values: unknown[] }[] = [];
  const database = {
    query: async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      return { rows: [] };
    },
  } as unknown as Pick<pg.Pool, 'query'>;
  return { database, queries };
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;

test('leased outbox uses the configured due, done and pending columns', async () => {
  const outbox = leasedOutbox({
    table: 'cs_email_outbox',
    dueColumn: 'due_at',
    doneColumn: 'sent_at',
    pending: 'sent_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL',
    maxAttempts: 3,
    backoff: { baseSeconds: 60, maxSeconds: 3600 },
  });
  assert.match(outbox.claim('o'), /^UPDATE cs_email_outbox o SET attempts = o\.attempts \+ 1/);
  assert.match(outbox.claim('o'), /WHERE sent_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL AND due_at <= now\(\)/);
  assert.match(outbox.claim('o'), /ORDER BY due_at, created_at LIMIT \$1 FOR UPDATE SKIP LOCKED\) claimed$/);

  const { database, queries } = recordingDatabase();
  await outbox.complete(database, 'a');
  await outbox.release(database, ['b']);
  assert.equal(await outbox.fail(database, { id: 'c', attempts: 2 }, 'X'.repeat(80), false), false);
  assert.equal(await outbox.fail(database, { id: 'd', attempts: 3 }, 'SMTP_ECONNECTION', false), true, 'the attempt budget is spent');
  assert.equal(await outbox.fail(database, { id: 'e', attempts: 1 }, 'SMTP_EENVELOPE', true), true, 'permanent errors end at once');
  assert.match(queries[0]!.sql, /SET sent_at = now\(\).*WHERE id = \$1 AND sent_at IS NULL$/);
  assert.match(
    queries[1]!.sql,
    /attempts = GREATEST\(attempts - 1, 0\) WHERE id = ANY\(\$1::uuid\[\]\) AND sent_at IS NULL AND cancelled_at IS NULL/,
  );
  assert.match(queries[2]!.sql, /due_at = now\(\) \+ make_interval\(secs => \$3\)/);
  assert.deepEqual(queries[2]!.values, ['c', 'X'.repeat(64), 120, false]);
  assert.deepEqual(queries[3]!.values, ['d', 'SMTP_ECONNECTION', 240, true]);
  assert.deepEqual([1, 2, 7, 20].map(outbox.backoffSeconds), [60, 120, 3600, 3600]);
});

test('leased outbox defaults to next_attempt_at and delivered_at and lets callers wrap updates', async () => {
  const outbox = leasedOutbox({ table: 'project_receipt_emails', maxAttempts: 6, backoff: { baseSeconds: 30, maxSeconds: 3600 } });
  assert.match(outbox.claim('r'), /WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now\(\)/);
  const { database, queries } = recordingDatabase();
  await outbox.complete(database, 'a', update => `WITH done AS (${update} RETURNING id) SELECT 1 FROM done`);
  assert.match(queries[0]!.sql, /^WITH done AS \(UPDATE project_receipt_emails SET delivered_at = now\(\)/);
  assert.equal(outbox.backoffSeconds(1), 30);
});

test('deliverLeased skips prepared-away items without counting them and passes the prepared value along', async () => {
  const items = [
    { id: 'a', attempts: 1 },
    { id: 'b', attempts: 1 },
    { id: 'c', attempts: 1 },
  ];
  const sent: string[] = [];
  const completed: [string, number][] = [];
  const failures: unknown[] = [];
  const result = await deliverLeased(
    {
      name: 'Test',
      leaseSeconds: 120,
      itemMs: 1000,
      claim: async () => items,
      release: async () => {},
      context: item => ({ id: item.id }),
      prepare: async item => (item.id === 'b' ? skip : item.id.length),
      send: async item => {
        sent.push(item.id);
        if (item.id === 'c') throw new MailDeliveryError('SMTP_EENVELOPE', true);
      },
      classify: mailFailure,
      fail: async (item, failure) => {
        failures.push([item.id, failure]);
        return failure.permanent;
      },
      complete: async (item, prepared) => {
        completed.push([item.id, prepared]);
      },
    },
    silentLog,
    () => 0,
  );
  assert.deepEqual(result, { delivered: 1, failed: 1, released: 0 });
  assert.deepEqual(sent, ['a', 'c']);
  assert.deepEqual(completed, [['a', 1]]);
  assert.deepEqual(failures, [['c', { code: 'SMTP_EENVELOPE', permanent: true, halt: false }]]);
});
