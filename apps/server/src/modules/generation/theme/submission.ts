import type { Redis } from 'ioredis';
import type pg from 'pg';
import { loadThemeOffer } from './offers.js';
import { createThemeJob, normalizeThemeInput, replayThemeRequest, type ThemeParameters } from './service.js';

export type ThemeSubmissionInput = Omit<ThemeParameters, 'cacheMode'> & {
  requestKey: string;
  offerId: string;
  cacheMode?: ThemeParameters['cacheMode'];
};

export async function submitThemeJob(pool: pg.Pool, redis: Pick<Redis, 'get'>, userId: string,
  input: ThemeSubmissionInput, requestId: string | null = null) {
  const { requestKey, offerId, schemeCode, sourceAssetId, requestedCount, cacheMode = 'reuse', searchId } = input;
  const parameters = { schemeCode, sourceAssetId, input: normalizeThemeInput(input.input), requestedCount, cacheMode, searchId };
  const replay = await replayThemeRequest(pool, userId, requestKey, parameters);
  if (replay) return replay;
  const offer = await loadThemeOffer(redis, offerId);
  return createThemeJob(pool, userId, requestKey, offerId, parameters, offer, requestId);
}
