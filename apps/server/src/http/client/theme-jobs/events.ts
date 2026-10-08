import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { streamEvents } from '../../sse.js';

export async function streamThemeJobEvents(pool: pg.Pool, redis: Redis, jobId: string, userId: string, reply: FastifyReply): Promise<void> {
  await streamEvents(redis, reply, { channels: [`theme-job:${jobId}`], replay: async () => {
    const job = (await pool.query<{ status: string; phase: string | null }>(
      'SELECT status, phase FROM theme_jobs WHERE id = $1 AND user_id = $2', [jobId, userId],
    )).rows[0];
    if (!job) throw new Error('Theme job not found');
    return [job];
  } });
}
