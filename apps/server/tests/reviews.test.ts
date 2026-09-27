import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { createReview, getSchemeReadiness, publishScheme, unpublishScheme } from '../src/modules/admin/reviews/service.js';

const scheme = {
  id: 'scheme-id', code: 'S-1', revision: 2, publishStatus: 'draft',
  verificationStatus: 'unverified', updatedAt: new Date('2026-01-01T00:00:00Z'),
};

type QueryResult = { rows: unknown[] };
type QueryHandler = (sql: string, params?: unknown[]) => QueryResult;

function poolFor(query: QueryHandler): pg.Pool {
  return {
    query: async (sql: string, params?: unknown[]) => query(sql, params),
    connect: async () => ({ query: async (sql: string, params?: unknown[]) => query(sql, params), release: () => {} }),
  } as unknown as pg.Pool;
}

test('readiness reports active asset counts, verification and blockers', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_assets')) return { rows: [{ type: 'rendering', count: 2 }, { type: 'model', count: 1 }] };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'pending_verification' }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const readiness = await getSchemeReadiness(pool, 'S-1');
  assert.deepEqual(readiness.blockers, ['效果图不足3张', '蒙版不足3张', '清单未核验']);
  assert.equal(readiness.assets.model.count, 1);
  assert.equal(readiness.assets.checklist.count, 0);
  assert.equal(readiness.assets.model.verified, false);
  assert.equal(readiness.canPublish, false);
});

test('review request keys replay the stored record, even after a revision change', async () => {
  const existing = {
    id: 'review-id', schemeId: scheme.id, requestKey: 'key', schemeRevision: 1,
    phase: 'overall', decision: 'pass', checks: { checked: true }, notes: null,
    adminId: null, createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [existing] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const record = await createReview(pool, 'S-1', null, {
    requestKey: 'key', schemeRevision: 1, phase: 'overall', decision: 'pass', checks: { checked: true },
  });
  assert.equal(record.id, 'review-id');
  assert.equal(record.createdAt, '2026-01-01T00:00:00.000Z');
});

test('review rejects stale revisions before insertion', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(createReview(pool, 'S-1', null, {
    requestKey: 'new', schemeRevision: 1, phase: 'overall', decision: 'reject', checks: {},
  }), { statusCode: 409 });
});

test('publish locks the scheme, rechecks readiness and commits', async () => {
  const queries: string[] = [];
  const pool = poolFor(sql => {
    queries.push(sql);
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_assets')) return { rows: [
      { type: 'model', count: 1 }, { type: 'rendering', count: 3 }, { type: 'mask', count: 3 },
    ] };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'verified' }] };
    if (sql.includes('UPDATE schemes')) return { rows: [{ ...scheme, publishStatus: 'published' }] };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const published = await publishScheme(pool, 'S-1', null);
  assert.equal(published.publishStatus, 'published');
  assert.ok(queries.some(sql => sql.includes('FOR UPDATE')));
  assert.equal(queries.at(-1), 'COMMIT');
});

test('publish rejects an already published scheme with a conflict', async () => {
  const queries: string[] = [];
  const pool = poolFor(sql => {
    queries.push(sql);
    if (sql.includes('FROM schemes WHERE code')) return { rows: [{ ...scheme, publishStatus: 'published' }] };
    if (['BEGIN', 'ROLLBACK'].includes(sql)) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(publishScheme(pool, 'S-1', null), { statusCode: 409 });
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('unpublish rejects an unpublished scheme', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(unpublishScheme(pool, 'S-1', null, 'withdrawn'), {
    statusCode: 400, message: 'Scheme is not published',
  });
});
