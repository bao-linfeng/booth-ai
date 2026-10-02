import assert from 'node:assert/strict';
import test from 'node:test';
import type { Queue } from 'bullmq';
import type pg from 'pg';
import { dispatchThemeOutbox } from '../src/modules/tasks/theme-outbox.js';
import { failThemeJob } from '../src/modules/tasks/theme-worker.js';

function dispatcherFixture(status = 'pending', failure?: 'add' | 'commit') {
  const events: string[] = [];
  let durable = { picked: false, status };
  let working = { ...durable };
  const queued = new Set<string>();
  let fail = failure;
  const database = { connect: async () => ({
    query: async (sql: string) => {
      if (sql === 'BEGIN') { events.push('begin'); working = { ...durable }; }
      else if (sql === 'COMMIT') {
        events.push('commit');
        if (fail === 'commit') { fail = undefined; throw new Error('commit failed'); }
        durable = { ...working };
      } else if (sql === 'ROLLBACK') events.push('rollback');
      else if (sql.includes('SELECT o.job_id')) return { rows: durable.picked ? [] : [{ jobId: 'job-1', status: durable.status }] };
      else if (sql.includes('UPDATE theme_job_outbox')) { events.push('mark'); working.picked = true; }
      else if (sql.includes('UPDATE theme_jobs')) { if (working.status === 'pending') working.status = 'queued'; }
      else throw new Error(`Unexpected query: ${sql}`);
      return { rows: [], rowCount: 1 };
    },
    release: () => { events.push('release'); },
  }) } as unknown as pg.Pool;
  const queue = {
    getJob: async () => undefined,
    add: async (_name: string, data: { jobId: string }, options: { jobId: string }) => {
      events.push('add');
      assert.equal(options.jobId, data.jobId);
      if (fail === 'add') { fail = undefined; throw new Error('add failed'); }
      queued.add(options.jobId);
    },
  } as unknown as Pick<Queue, 'add' | 'getJob'>;
  return { database, queue, events, queued, state: () => durable };
}

test('theme outbox commits its marker only after enqueue succeeds', async () => {
  const f = dispatcherFixture();
  await dispatchThemeOutbox(f.database, f.queue);
  assert.deepEqual(f.events, ['begin', 'add', 'mark', 'commit', 'release']);
  assert.deepEqual(f.state(), { picked: true, status: 'queued' });
});

for (const failure of ['add', 'commit'] as const) {
  test(`theme outbox retains retryable state after ${failure} failure`, async () => {
    const f = dispatcherFixture('pending', failure);
    await assert.rejects(dispatchThemeOutbox(f.database, f.queue), new RegExp(`${failure} failed`));
    assert.deepEqual(f.state(), { picked: false, status: 'pending' });
    assert.deepEqual(f.events.slice(-2), ['rollback', 'release']);
    assert.equal(f.queued.size, failure === 'commit' ? 1 : 0);
    await dispatchThemeOutbox(f.database, f.queue);
    assert.equal(f.queued.size, 1);
    assert.deepEqual(f.state(), { picked: true, status: 'queued' });
  });
}

for (const state of ['completed', 'failed'] as const) {
  test(`theme outbox retries a retained ${state} queue job with the same ID`, async () => {
    const f = dispatcherFixture('queued');
    const queue = {
      getJob: async (id: string) => {
        assert.equal(id, 'job-1');
        return { getState: async () => state, retry: async (from: string) => { assert.equal(from, state); f.events.push('retry'); } };
      },
      add: async () => assert.fail('A terminal queue record needs retry, not a deduplicated add'),
    } as unknown as Pick<Queue, 'add' | 'getJob'>;
    await dispatchThemeOutbox(f.database, queue);
    assert.deepEqual(f.events, ['begin', 'retry', 'mark', 'commit', 'release']);
  });
}

for (const status of ['running', 'settling', 'succeeded', 'partially_succeeded', 'failed']) {
  test(`theme outbox does not re-enqueue a ${status} database job`, async () => {
    const f = dispatcherFixture(status);
    await dispatchThemeOutbox(f.database, f.queue);
    assert.equal(f.queued.size, 0);
    assert.deepEqual(f.state(), { picked: true, status });
  });
}

test('terminal theme failure releases reserved credits in the same transaction', async () => {
  const queries: string[] = [];
  const database = { connect: async () => ({
    query: async (sql: string) => { queries.push(sql); return { rows: [{ id: 'job-1' }], rowCount: 1 }; },
    release: () => {},
  }) } as unknown as pg.Pool;
  await failThemeJob(database, 'job-1');
  assert.equal(queries[0], 'BEGIN');
  assert.match(queries[1]!, /UPDATE theme_jobs/);
  assert.match(queries[2]!, /UPDATE credit_reservations/);
  assert.equal(queries[3], 'COMMIT');
});
