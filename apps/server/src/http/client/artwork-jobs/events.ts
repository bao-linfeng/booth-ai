import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Principal } from '../../../modules/identity/principal.js';
import { sessionHeartbeat } from '../../authentication.js';
import { streamEvents } from '../../sse.js';
import { artworkJobStatus } from '../../../modules/generation/artwork/queries.js';

export async function streamArtworkJobEvents(pool: pg.Pool, redis: Redis, jobId: string, principal: Principal, reply: FastifyReply): Promise<void> {
  const userId = principal.localId;
  await streamEvents(redis, reply, { channels: [`artwork-job:${jobId}`], onHeartbeat: sessionHeartbeat(pool, redis, principal), replay: async () => {
    return [await artworkJobStatus(pool, userId, jobId)];
  } });
}
