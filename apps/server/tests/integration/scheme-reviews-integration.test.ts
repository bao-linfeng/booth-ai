import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { createReview, type CreateReviewInput } from '../../src/modules/schemes/reviews.js';

test('review request keys only replay the same scheme and payload', { skip: !process.env.BOM_TEST_DATABASE_URL }, async t => {
  const pool = new pg.Pool({ connectionString: process.env.BOM_TEST_DATABASE_URL });
  const code = `review-test-${randomUUID()}`;
  const otherCode = `review-test-${randomUUID()}`;
  const adminId = randomUUID();
  const requestKey = randomUUID();
  t.after(async () => {
    await pool.query('DELETE FROM schemes WHERE code = ANY($1::text[])', [[code, otherCode]]);
    await pool.query('DELETE FROM admin_audit_logs WHERE admin_id = $1', [adminId]);
    await pool.query('DELETE FROM admins WHERE id = $1', [adminId]);
    await pool.end();
  });
  await pool.query(
    "INSERT INTO admins (id,external_user_id,username,roles,permissions) VALUES ($1,$2,$3,ARRAY['ROLE_ADMIN'],ARRAY['scheme.review'])",
    [adminId, Math.floor(Math.random() * 1e12), code],
  );
  await pool.query('INSERT INTO schemes (code, name) VALUES ($1, $1), ($2, $2)', [code, otherCode]);
  const revision = (await pool.query<{ revision: number }>('SELECT revision FROM schemes WHERE code = $1', [code])).rows[0]!.revision;
  const input: CreateReviewInput = {
    requestKey,
    schemeRevision: revision,
    phase: 'asset_verification',
    decision: 'reject',
    checks: { model: true, drawing: false },
    notes: '图纸缺失',
  };

  const created = await createReview(pool, code, adminId, input);
  assert.equal((await createReview(pool, code, adminId, input)).id, created.id);
  // jsonb 比较与键顺序无关
  assert.equal((await createReview(pool, code, adminId, { ...input, checks: { drawing: false, model: true } })).id, created.id);
  // 方案修改后，原样重放仍返回原记录
  await pool.query('UPDATE schemes SET revision = revision + 1 WHERE code = $1', [code]);
  assert.equal((await createReview(pool, code, adminId, input)).id, created.id);

  const conflict = { statusCode: 409, reason: 'IDEMPOTENCY_CONFLICT' };
  await assert.rejects(createReview(pool, otherCode, adminId, { ...input, schemeRevision: 1 }), conflict);
  await assert.rejects(createReview(pool, otherCode, adminId, input), conflict);
  await assert.rejects(createReview(pool, code, adminId, { ...input, decision: 'pass' }), conflict);
  await assert.rejects(createReview(pool, code, adminId, { ...input, phase: 'overall' }), conflict);
  await assert.rejects(createReview(pool, code, adminId, { ...input, schemeRevision: revision + 1 }), conflict);
  await assert.rejects(createReview(pool, code, adminId, { ...input, checks: { model: true, drawing: true } }), conflict);
  await assert.rejects(createReview(pool, code, adminId, { ...input, notes: '其他备注' }), conflict);
  await assert.rejects(createReview(pool, code, adminId, { ...input, notes: null }), conflict);

  const rows = await pool.query('SELECT scheme_id FROM scheme_reviews WHERE request_key = $1', [requestKey]);
  assert.equal(rows.rowCount, 1);
});
