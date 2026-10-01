import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { createReview, getSchemeReadiness, publishScheme, unpublishScheme } from '../src/modules/admin/reviews/service.js';

const scheme = {
  id: 'scheme-id', code: 'S-1', revision: 2, publishStatus: 'draft',
  verificationStatus: 'unverified', updatedAt: new Date('2026-01-01T00:00:00Z'),
  lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: '18',
  openingCount: 2, productSystemId: 'system-id',
  applicableConditions: { status: 'confirmed', rules: [], labelsConfirmed: true },
};

const assetTime = new Date('2026-01-01T00:00:00Z');
const assets = [
  { id: 'model', type: 'model', sortOrder: 0 },
  { id: 'checklist', type: 'checklist', sortOrder: 0 },
  { id: 'drawing', type: 'drawing', sortOrder: 0 },
  { id: 'artwork', type: 'artwork', sortOrder: 0 },
  ...[0, 1, 2].map(index => ({ id: `render-${index}`, type: 'rendering', sortOrder: index, widthPx: 1600, heightPx: 900, mimeType: 'image/png' })),
  ...[0, 1, 2].map(index => ({ id: `mask-${index}`, type: 'mask', sortOrder: index, relatedAssetId: `render-${index}`, widthPx: 1600, heightPx: 900, mimeType: 'image/png' })),
].map(asset => ({ relatedAssetId: null, widthPx: null, heightPx: null, mimeType: 'application/octet-stream', ...asset,
  objectKey: asset.id, byteSize: '1024', updatedAt: assetTime }));
const passedReview = { decision: 'pass', createdAt: new Date('2026-01-02T00:00:00Z') };
const adminId = '00000000-0000-4000-8000-000000000001';

type QueryResult = { rows: unknown[] };
type QueryHandler = (sql: string, params?: unknown[]) => QueryResult;

function poolFor(query: QueryHandler): pg.Pool {
  const run = (sql: string, params?: unknown[]) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) ? { rows: [] } :
    sql.includes("d.code = 'product_system'") ? { rows: [{ exists: true }] } :
    sql.includes('AS invalid') ? { rows: [{ invalid: false }] } : query(sql, params);
  return {
    query: async (sql: string, params?: unknown[]) => run(sql, params),
    connect: async () => ({ query: async (sql: string, params?: unknown[]) => run(sql, params), release: () => {} }),
  } as unknown as pg.Pool;
}

test('readiness reports active asset counts, verification and blockers', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_assets')) return { rows: assets.filter(asset => asset.type !== 'checklist' && asset.type !== 'mask' && asset.id !== 'render-2') };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'pending_verification' }] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const readiness = await getSchemeReadiness(pool, 'S-1');
  assert.ok(readiness.blockers.includes('必须恰好有3张效果图'));
  assert.ok(readiness.blockers.includes('必须恰好有3张蒙版'));
  assert.ok(readiness.blockers.includes('缺少清单资产'));
  assert.ok(readiness.blockers.includes('清单未核验'));
  assert.ok(readiness.blockers.includes('缺少当前修订的整体审核通过记录'));
  assert.equal(readiness.assets.model.count, 1);
  assert.equal(readiness.assets.checklist.count, 0);
  assert.equal(readiness.assets.model.verified, false);
  assert.equal(readiness.canPublish, false);
});

test('readiness requires a valid opening count without directions', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [{ ...scheme, openingCount: null }] };
    if (sql.includes('FROM scheme_assets')) return { rows: assets };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'verified' }] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [passedReview] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const readiness = await getSchemeReadiness(pool, 'S-1');
  assert.ok(readiness.blockers.includes('开口面数未核对'));
  assert.equal(readiness.canPublish, false);
});

test('readiness requires masks to use the same sort order as their renderings', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_assets')) return {
      rows: assets.map(asset => asset.id === 'mask-1' ? { ...asset, sortOrder: 9 } : asset),
    };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'verified' }] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [passedReview] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const readiness = await getSchemeReadiness(pool, 'S-1');
  assert.ok(readiness.blockers.includes('效果图与蒙版未逐一配对或图片规格不符'));
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
  const record = await createReview(pool, 'S-1', adminId, {
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
  await assert.rejects(createReview(pool, 'S-1', adminId, {
    requestKey: 'new', schemeRevision: 1, phase: 'overall', decision: 'reject', checks: {},
  }), { statusCode: 409 });
});

test('publish locks the scheme, rechecks readiness and commits', async () => {
  const queries: string[] = [];
  const pool = poolFor(sql => {
    queries.push(sql);
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_assets')) return { rows: assets };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'verified' }] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [passedReview] };
    if (sql.includes('UPDATE schemes')) return { rows: [{ ...scheme, publishStatus: 'published' }] };
    if (sql.includes('INSERT INTO admin_audit_logs')) return { rows: [] };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const published = await publishScheme(pool, 'S-1', adminId);
  assert.equal(published.publishStatus, 'published');
  assert.ok(queries.some(sql => sql.includes('FOR UPDATE')));
  assert.ok(queries.some(sql => sql.includes('INSERT INTO admin_audit_logs')));
});

test('publish refuses assets changed after the overall review', async () => {
  const queries: string[] = [];
  const pool = poolFor(sql => {
    queries.push(sql);
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_assets')) return { rows: assets.map(asset => asset.id === 'model' ? { ...asset, updatedAt: new Date('2026-01-03T00:00:00Z') } : asset) };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'verified' }] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [passedReview] };
    if (['BEGIN', 'ROLLBACK'].includes(sql)) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(publishScheme(pool, 'S-1', adminId), { statusCode: 400, message: '审核后资产发生变化' });
});

test('passing an overall review requires complete assets and confirmed applicability', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [{ ...scheme, applicableConditions: null }] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [] };
    if (sql.includes('FROM scheme_assets')) return { rows: assets };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'verified' }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(createReview(pool, 'S-1', adminId, {
    requestKey: 'overall-pass', schemeRevision: 2, phase: 'overall', decision: 'pass', checks: { assetsComplete: true, bomVerified: true, renderingsAndMasks: true, drawingsComplete: true },
  }), { statusCode: 400, message: '适用条件未确认' });
});

test('a complete draft can receive an overall pass before publication', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [] };
    if (sql.includes('FROM scheme_assets')) return { rows: assets };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'verified' }] };
    if (sql.includes('INSERT INTO scheme_reviews')) return { rows: [{
      id: 'review-2', schemeId: scheme.id, requestKey: 'overall-new', schemeRevision: 2,
      phase: 'overall', decision: 'pass', checks: {}, notes: null, adminId: null, createdAt: passedReview.createdAt,
    }] };
    if (sql.includes('INSERT INTO admin_audit_logs')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const review = await createReview(pool, 'S-1', adminId, {
    requestKey: 'overall-new', schemeRevision: 2, phase: 'overall', decision: 'pass', checks: { assetsComplete: true, bomVerified: true, renderingsAndMasks: true, drawingsComplete: true },
  });
  assert.equal(review.decision, 'pass');
});

test('overall pass rejects unchecked evidence before writing a review', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(createReview(pool, 'S-1', adminId, {
    requestKey: 'unchecked', schemeRevision: 2, phase: 'overall', decision: 'pass', checks: { assetsComplete: true },
  }), { statusCode: 400, message: 'Overall review checks must all pass' });
});

test('unconfigured applicability questions cannot be published as invisible candidates', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [{ ...scheme, applicableConditions: {
      status: 'confirmed', rules: [{ id: 'venue-restriction', expectedValue: true }], labelsConfirmed: true,
    } }] };
    if (sql.includes('FROM scheme_assets')) return { rows: assets };
    if (sql.includes('JOIN scheme_boms')) return { rows: [{ status: 'verified' }] };
    if (sql.includes('FROM scheme_reviews')) return { rows: [passedReview] };
    if (sql.includes('FROM applicability_questions')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const readiness = await getSchemeReadiness(pool, 'S-1');
  assert.ok(readiness.blockers.some(b => b.includes('适用问题未在系统配置')));
  assert.equal(readiness.canPublish, false);
});

test('publish rejects an already published scheme with a conflict', async () => {
  const queries: string[] = [];
  const pool = poolFor(sql => {
    queries.push(sql);
    if (sql.includes('FROM schemes WHERE code')) return { rows: [{ ...scheme, publishStatus: 'published' }] };
    if (['BEGIN', 'ROLLBACK'].includes(sql)) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(publishScheme(pool, 'S-1', adminId), { statusCode: 409 });
});

test('unpublish rejects an unpublished scheme', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM schemes WHERE code')) return { rows: [scheme] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(unpublishScheme(pool, 'S-1', adminId, 'withdrawn'), {
    statusCode: 400, message: 'Scheme is not published',
  });
});
