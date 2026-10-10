import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../infra/database.js';
import { TASK_NAME } from '../../infra/queue.js';

export interface Task {
  id: string;
  request_key: string;
  kind: string;
  payload: { message: string };
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  result: { message: string } | null;
  error_code: string | null;
}

// Internal foundation probe, deliberately not exposed as an unauthenticated HTTP API.
export async function submitEchoTask(pool: pg.Pool, requestKey: string, message: string): Promise<Task> {
  if (!requestKey || requestKey.length > 200 || !message || message.length > 1000) throw new Error('Invalid echo task');
  return transaction(pool, async client => {
    const { rows } = await client.query<Task>(
      `INSERT INTO foundation_tasks(id, request_key, kind, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (request_key) DO NOTHING RETURNING *`,
      [randomUUID(), requestKey, TASK_NAME, { message }],
    );
    const created = rows[0];
    if (created) {
      await client.query('INSERT INTO foundation_outbox(id, task_id) VALUES ($1, $2)', [randomUUID(), created.id]);
      return created;
    }
    const existing = (await client.query<Task>('SELECT * FROM foundation_tasks WHERE request_key = $1', [requestKey])).rows[0];
    if (!existing || existing.payload.message !== message) throw new Error('Idempotency key already used with different payload');
    return existing;
  });
}

export async function processEchoTask(pool: pg.Pool, taskId: string) {
  return transaction(pool, async client => {
    const task = (await client.query<Task>('SELECT * FROM foundation_tasks WHERE id = $1 FOR UPDATE', [taskId])).rows[0];
    if (!task || task.kind !== TASK_NAME) throw new Error('Unknown foundation task');
    if (task.status === 'succeeded') return task.result;
    const result = { message: task.payload.message };
    await client.query(
      `UPDATE foundation_tasks SET status = 'succeeded', result = $2, error_code = NULL, updated_at = now() WHERE id = $1`,
      [taskId, result],
    );
    return result;
  });
}
