import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { streamJobEvents } from '../sse.js';

export async function streamArtworkJobEvents(pool: pg.Pool, redis: Redis, jobId: string, userId: string, reply: FastifyReply): Promise<void> {
  await streamJobEvents(redis, `artwork-job:${jobId}`, reply, async () => {
    const job = (await pool.query<{ status: string; phase: string | null; deliveryStatus: string }>(
      'SELECT status, phase, delivery_status AS "deliveryStatus" FROM artwork_jobs WHERE id = $1 AND user_id = $2', [jobId, userId],
    )).rows[0];
    if (!job) throw new Error('Artwork job not found');
    return job;
  });
}
