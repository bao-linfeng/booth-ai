import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Principal } from '../../../modules/identity/principal.js';
import { sessionHeartbeat } from '../../authentication.js';
import { streamEvents } from '../../sse.js';

export async function streamThemeJobEvents(pool: pg.Pool, redis: Redis, jobId: string, principal: Principal, reply: FastifyReply): Promise<void> {
  const userId = principal.localId;
  await streamEvents(redis, reply, { channels: [`theme-job:${jobId}`], onHeartbeat: sessionHeartbeat(pool, redis, principal), replay: async () => {
    const job = (await pool.query<{ status: string; phase: string | null }>(
      'SELECT status, phase FROM theme_jobs WHERE id = $1 AND user_id = $2', [jobId, userId],
    )).rows[0];
    if (!job) throw new Error('Theme job not found');
    return [job];
  } });
}
