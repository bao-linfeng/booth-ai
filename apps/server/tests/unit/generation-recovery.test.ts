import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { decideRecovery, recoverGenerationJobs, type RecoveryQueues } from '../../src/workers/generation-recovery.js';

test('recovery matrix maps database status, queue state and deadline to one action for both job kinds', () => {
  const active = ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children', 'unknown'];
  for (const status of ['pending', 'queued', 'running', 'settling']) {
    const fresh = { status, expired: false };
    assert.equal(decideRecovery(fresh, undefined), 'enqueue', `${status}: lost queue record`);
    assert.equal(decideRecovery(fresh, 'completed'), 'retry', `${status}: completed without progress`);
    for (const state of active) assert.equal(decideRecovery(fresh, state), 'wait', `${status}: ${state}`);
  }
  assert.equal(decideRecovery({ status: 'pending', expired: false }, 'failed'), 'settle');
  assert.equal(decideRecovery({ status: 'queued', expired: false }, 'failed'), 'settle');
  assert.equal(decideRecovery({ status: 'running', expired: false }, 'failed'), 'retry');
  assert.equal(decideRecovery({ status: 'settling', expired: false }, 'failed'), 'retry');
  for (const state of [undefined, 'failed', 'completed', 'active']) {
    assert.equal(decideRecovery({ status: 'running', expired: true }, state), 'settle');
  }
});

test('recovery applies the matrix to theme and artwork alike and isolates per-job failures', async () => {
  const candidates = {
    theme: [
      { id: 'theme-lost', status: 'queued', expired: false },
      { id: 'theme-broken', status: 'running', expired: false },
      { id: 'theme-stalled', status: 'running', expired: false },
    ],
    artwork: [
      { id: 'artwork-exhausted', status: 'queued', expired: false },
      { id: 'artwork-waiting', status: 'running', expired: false },
      { id: 'artwork-expired', status: 'running', expired: true },
    ],
  };
  const sql: string[] = [];
  const settled: string[] = [];
  const database = {
    query: async (text: string) => {
      sql.push(text);
      return { rows: candidates[text.includes('FROM theme_jobs') ? 'theme' : 'artwork'] };
    },
    // Settlement opens its own transaction; an empty lookup ends it without touching the job.
    connect: async () => ({
      query: async (text: string, params?: unknown[]) => {
        if (text.includes('SELECT user_id')) settled.push(String(params?.[0]));
        return { rows: [] };
      },
      release: () => {},
    }),
  } as unknown as pg.Pool;
  const queueStates: Record<string, string> = { 'theme-stalled': 'failed', 'artwork-exhausted': 'failed', 'artwork-waiting': 'waiting' };
  const actions: string[] = [];
  const queue = {
    getJob: async (id: string) => {
      if (id === 'artwork-expired') assert.fail('Expired jobs settle without consulting the queue');
      if (id === 'theme-broken') throw Object.assign(new Error('Redis unavailable'), { code: 'ECONNREFUSED' });
      const state = queueStates[id];
      return state
        ? {
            getState: async () => state,
            retry: async (from: string) => {
              actions.push(`retry:${id}:${from}`);
            },
          }
        : undefined;
    },
    add: async (_name: string, data: { jobId: string }, options: { jobId: string; attempts: number }) => {
      assert.equal(options.jobId, data.jobId);
      assert.equal(options.attempts, 3);
      actions.push(`enqueue:${data.jobId}`);
    },
  };
  const report = await recoverGenerationJobs(database, { theme: queue, artwork: queue } as unknown as RecoveryQueues);

  assert.deepEqual(actions, ['enqueue:theme-lost', 'retry:theme-stalled:failed']);
  assert.deepEqual(settled, ['artwork-exhausted', 'artwork-expired']);
  assert.deepEqual(report, { enqueued: 1, retried: 1, settled: 2, errors: [{ kind: 'theme', id: 'theme-broken', code: 'ECONNREFUSED' }] });
  assert.equal(sql.length, 2);
  for (const text of sql) {
    assert.match(text, /status IN \('pending', 'queued', 'running', 'settling'\)/);
    assert.match(text, /lease_until IS NULL OR lease_until < now\(\)/);
  }
});
