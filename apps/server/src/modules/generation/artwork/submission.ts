import type { Redis } from 'ioredis';
import type pg from 'pg';
import { loadArtworkOffer } from './offers.js';
import { createArtworkJob, replayArtworkRequest, type ArtworkContext } from './service.js';

export type ArtworkSubmissionInput = ArtworkContext & { requestKey: string; offerId: string };

export async function submitArtworkJob(pool: pg.Pool, redis: Pick<Redis, 'get'>, userId: string,
  input: ArtworkSubmissionInput, requestId: string | null = null) {
  const replay = await replayArtworkRequest(pool, userId, input.requestKey, input);
  if (replay) return replay;
  const offer = await loadArtworkOffer(redis, input.offerId);
  return createArtworkJob(pool, userId, input.requestKey, input.offerId, input, offer, requestId);
}
