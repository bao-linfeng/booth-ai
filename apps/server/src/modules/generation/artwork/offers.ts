import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { domainError as projectError } from '../../../lib/errors.js';
import { loadArtworkSnapshot } from './service.js';
import { ARTWORK_QUALITY, type ArtworkContext, type ArtworkOffer } from './types.js';

const OFFER_TTL_SECONDS = 300;

export async function createArtworkOffer(pool: pg.Pool, redis: Pick<Redis, 'set'>, userId: string, context: ArtworkContext) {
  const snapshot = await loadArtworkSnapshot(pool, userId, context);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000).toISOString();
  const offer: ArtworkOffer = { ...context, userId, snapshot, unitCredits: snapshot.model.unitCredits!, expiresAt };
  await redis.set(`artwork-offer:${id}`, JSON.stringify(offer), 'EX', OFFER_TTL_SECONDS);
  return {
    available: true,
    offer: { id, expiresAt, unitCredits: offer.unitCredits, maxCredits: offer.unitCredits * 4, settlementRule: 'per_usable_direction' },
    quality: ARTWORK_QUALITY,
  };
}

export async function loadArtworkOffer(redis: Pick<Redis, 'get'>, offerId: string): Promise<ArtworkOffer> {
  const raw = await redis.get(`artwork-offer:${offerId}`);
  if (!raw) throw projectError('OFFER_EXPIRED');
  return JSON.parse(raw) as ArtworkOffer;
}
