import type pg from 'pg';
import type { Queue } from 'bullmq';
import { transaction } from '../infra/database.js';
import { TASK_NAME } from '../infra/queue.js';

// PostgreSQL locks coordinate multiple dispatchers. A crash after add() is safe:
// retry uses the same jobId, and the processor checks durable completion as well.
export async function dispatchOutbox(pool: pg.Pool, queue: Pick<Queue, 'add'>): Promise<number> {
  return transaction(pool, async client => {
    const { rows } = await client.query<{ id: string; task_id: string }>(
      'SELECT id, task_id FROM foundation_outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED',
    );
    for (const event of rows) {
      await queue.add(TASK_NAME, { taskId: event.task_id }, { jobId: event.task_id });
      await client.query('UPDATE foundation_outbox SET published_at = now() WHERE id = $1', [event.id]);
    }
    return rows.length;
  });
}
