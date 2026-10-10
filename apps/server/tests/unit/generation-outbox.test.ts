import assert from 'node:assert/strict';
import test from 'node:test';
import type { Queue } from 'bullmq';
import type pg from 'pg';
import { dispatchGenerationOutbox, type GenerationKind } from '../../src/workers/generation-outbox.js';
import { settleThemeJob } from '../../src/modules/generation/theme/execution.js';

function dispatcherFixture(kind: GenerationKind, status = 'pending', failure?: 'add' | 'commit') {
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
      else if (sql.includes('SELECT o.job_id')) {
        assert.match(sql, new RegExp(`FROM ${kind}_job_outbox o\\s+JOIN ${kind}_jobs j`));
        assert.match(sql, /FOR UPDATE OF j, o SKIP LOCKED/);
        return { rows: durable.picked ? [] : [{ jobId: 'job-1', status: durable.status }] };
      }
      else if (sql.includes(`UPDATE ${kind}_job_outbox`)) { events.push('mark'); working.picked = true; }
      else if (sql.includes(`UPDATE ${kind}_jobs`)) { if (working.status === 'pending') working.status = 'queued'; }
      else throw new Error(`Unexpected query: ${sql}`);
      return { rows: [], rowCount: 1 };
    },
    release: () => { events.push('release'); },
  }) } as unknown as pg.Pool;
  const queue = {
    add: async (name: string, data: { jobId: string }, options: { jobId: string }) => {
      events.push('add');
      assert.equal(name, kind === 'theme' ? 'theme.generate' : 'artwork.generate');
      assert.equal(options.jobId, data.jobId);
      if (fail === 'add') { fail = undefined; throw new Error('add failed'); }
      queued.add(options.jobId);
    },
  } as unknown as Pick<Queue, 'add'>;
  const publish = async (jobId: string, event: unknown) => {
    assert.equal(jobId, 'job-1');
    assert.deepEqual(event, { status: 'queued' });
    events.push('publish');
  };
  return { database, queue, publish, events, queued, state: () => durable };
}

for (const kind of ['theme', 'artwork'] as const) {
  test(`${kind} outbox commits its marker only after enqueue succeeds, then publishes`, async () => {
    const f = dispatcherFixture(kind);
    assert.equal(await dispatchGenerationOutbox(f.database, kind, f.queue, f.publish), 1);
    assert.deepEqual(f.events, ['begin', 'add', 'mark', 'commit', 'release', 'publish']);
    assert.deepEqual(f.state(), { picked: true, status: 'queued' });
  });

  for (const failure of ['add', 'commit'] as const) {
    test(`${kind} outbox retains retryable state after ${failure} failure`, async () => {
      const f = dispatcherFixture(kind, 'pending', failure);
      await assert.rejects(dispatchGenerationOutbox(f.database, kind, f.queue, f.publish), new RegExp(`${failure} failed`));
      assert.deepEqual(f.state(), { picked: false, status: 'pending' });
      assert.deepEqual(f.events.slice(-2), ['rollback', 'release']);
      assert.ok(!f.events.includes('publish'));
      assert.equal(f.queued.size, failure === 'commit' ? 1 : 0);
      await dispatchGenerationOutbox(f.database, kind, f.queue, f.publish);
      assert.equal(f.queued.size, 1);
      assert.deepEqual(f.state(), { picked: true, status: 'queued' });
    });
  }

  for (const status of ['running', 'settling', 'succeeded', 'partially_succeeded', 'failed']) {
    test(`${kind} outbox does not re-enqueue a ${status} database job`, async () => {
      const f = dispatcherFixture(kind, status);
      assert.equal(await dispatchGenerationOutbox(f.database, kind, f.queue, f.publish), 0);
      assert.equal(f.queued.size, 0);
      assert.ok(!f.events.includes('publish'));
      assert.deepEqual(f.state(), { picked: true, status });
    });
  }
}

test('terminal theme failure releases reserved credits in the same transaction', async () => {
  const queries: string[] = [];
  let status = 'running';
  const database = { connect: async () => ({
    query: async (sql: string, params?: unknown[]) => {
      queries.push(sql);
      if (sql.includes('SELECT user_id') && sql.includes('FROM theme_jobs') && !sql.includes('unit_credits')) return { rows: [{ userId: 'user-1' }] };
      if (sql.includes('FROM users')) return { rows: [{ id: 'user-1' }] };
      if (sql.includes('FOR UPDATE') && sql.includes('theme_jobs')) return { rows: [{ userId: 'user-1', status, unitCredits: 10,
        requestedCount: 1, usableCount: 0, cacheHit: false, leaseToken: null, leaseUntil: null }] };
      if (sql.includes('UPDATE theme_jobs SET status = $1')) status = String(params?.[0]);
      if (sql.includes('credit_transactions')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  }) } as unknown as pg.Pool;
  await settleThemeJob(database, 'job-1');
  assert.equal(queries[0], 'BEGIN');
  assert.ok(queries.some(query => /UPDATE theme_jobs/.test(query)));
  assert.ok(queries.some(query => /UPDATE credit_reservations/.test(query)));
  assert.equal(queries.at(-1), 'COMMIT');
});
