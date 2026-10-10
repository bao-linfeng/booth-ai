import type pg from 'pg';
import { writeAuditLog } from '../../infra/audit.js';
import { transaction } from '../../infra/database.js';
import { loadAndEvaluate, type SchemeRow as ReadinessSchemeRow } from './readiness.js';

type DbClient = pg.Pool | pg.PoolClient;

// Re-export for consumers that previously imported from reviews.ts
export { getSchemeReadiness, type SchemeReadiness as ReadinessResult, BLOCKER_MESSAGES } from './readiness.js';
import { BLOCKER_MESSAGES as _BM } from './readiness.js';
function blockerMessage(code: string): string {
  return _BM[code as keyof typeof _BM] ?? code;
}

interface SchemeRow extends ReadinessSchemeRow {
  updatedAt: Date | string;
}

export interface CreateReviewInput {
  requestKey: string;
  schemeRevision: number;
  phase: 'asset_verification' | 'overall';
  decision: 'pass' | 'reject';
  checks: Record<string, boolean>;
  notes?: string | null;
}

export interface ReviewRecord {
  id: string;
  schemeId: string;
  requestKey: string;
  schemeRevision: number;
  phase: CreateReviewInput['phase'];
  decision: CreateReviewInput['decision'];
  checks: Record<string, boolean>;
  notes: string | null;
  adminId: string | null;
  createdAt: string;
}

export interface PublishedScheme {
  id: string;
  code: string;
  revision: number;
  publishStatus: string;
  verificationStatus: string;
  updatedAt: string;
}

const schemeColumns = `id::text AS id, code, revision,
  publish_status AS "publishStatus", verification_status AS "verificationStatus",
  updated_at AS "updatedAt",
  length_mm AS "lengthMm", width_mm AS "widthMm", height_mm AS "heightMm",
  area_sqm::text AS "areaM2", opening_count AS "openingCount",
  product_system_id::text AS "productSystemId"`;

const reviewColumns = `id::text AS id, scheme_id::text AS "schemeId",
  request_key AS "requestKey", scheme_revision AS "schemeRevision",
  phase, decision, checks, notes, admin_id::text AS "adminId",
  created_at AS "createdAt"`;

interface ReviewRow extends Omit<ReviewRecord, 'createdAt'> {
  createdAt: Date | string;
}

function requestError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toReviewRecord(row: ReviewRow): ReviewRecord {
  return { ...row, createdAt: toIsoString(row.createdAt) };
}

function toPublishedScheme(row: SchemeRow): PublishedScheme {
  return {
    id: row.id,
    code: row.code,
    revision: row.revision,
    publishStatus: row.publishStatus,
    verificationStatus: row.verificationStatus,
    updatedAt: toIsoString(row.updatedAt),
  };
}

async function findScheme(client: DbClient, code: string, lock = false): Promise<SchemeRow> {
  const result = await client.query<SchemeRow>(`SELECT ${schemeColumns} FROM schemes WHERE code = $1${lock ? ' FOR UPDATE' : ''}`, [code]);
  const scheme = result.rows[0];
  if (!scheme) throw requestError('Scheme not found', 404);
  return scheme;
}

export async function createReview(pool: pg.Pool, code: string, adminId: string, input: CreateReviewInput): Promise<ReviewRecord> {
  return transaction(pool, async client => {
    const scheme = await findScheme(client, code, true);
    const previous = await client.query<ReviewRow>(`SELECT ${reviewColumns} FROM scheme_reviews WHERE request_key = $1`, [
      input.requestKey,
    ]);
    if (previous.rows[0]) return toReviewRecord(previous.rows[0]);
    if (scheme.revision !== input.schemeRevision) throw requestError('Scheme revision conflict', 409);
    if (input.phase === 'overall' && input.decision === 'pass') {
      if (!['assetsComplete', 'bomVerified', 'renderingsAndMasks', 'drawingsComplete'].every(key => input.checks[key] === true))
        throw requestError('Overall review checks must all pass', 400);
      const readiness = await loadAndEvaluate(client, scheme);
      // 创建审核时只检查内容完整性（coreBlockers），不检查"缺少当前审核通过记录"本身
      if (readiness.coreBlockers.length) {
        throw requestError(blockerMessage(readiness.coreBlockers[0]!), 400);
      }
    }
    const inserted = await client.query<ReviewRow>(
      `INSERT INTO scheme_reviews (scheme_id, request_key, scheme_revision, phase, decision, checks, notes, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (request_key) DO NOTHING RETURNING ${reviewColumns}`,
      [
        scheme.id,
        input.requestKey,
        input.schemeRevision,
        input.phase,
        input.decision,
        JSON.stringify(input.checks),
        input.notes ?? null,
        adminId,
      ],
    );
    if (inserted.rows[0]) {
      await writeAuditLog(client, {
        adminId,
        action: 'review.create',
        targetType: 'scheme',
        targetId: scheme.code,
        detail: { phase: input.phase, decision: input.decision, schemeRevision: input.schemeRevision },
      });
      return toReviewRecord(inserted.rows[0]);
    }
    const existing = await client.query<ReviewRow>(`SELECT ${reviewColumns} FROM scheme_reviews WHERE request_key = $1`, [
      input.requestKey,
    ]);
    if (!existing.rows[0]) throw requestError('Failed to create review', 500);
    return toReviewRecord(existing.rows[0]);
  });
}

export async function publishScheme(pool: pg.Pool, code: string, adminId: string): Promise<PublishedScheme> {
  return transaction(pool, async client => {
    const scheme = await findScheme(client, code, true);
    if (scheme.publishStatus === 'published') throw requestError('Scheme is already published', 409);
    const readiness = await loadAndEvaluate(client, scheme);
    if (readiness.blockers.length) throw requestError(blockerMessage(readiness.blockers[0]!), 400);
    const result = await client.query<SchemeRow>(
      `UPDATE schemes SET publish_status = 'published', verification_status = 'verified', updated_by = $2, updated_at = now() WHERE id = $1 RETURNING ${schemeColumns}`,
      [scheme.id, adminId],
    );
    const updated = result.rows[0];
    if (!updated) throw requestError('Scheme not found', 404);
    await writeAuditLog(client, {
      adminId,
      action: 'scheme.publish',
      targetType: 'scheme',
      targetId: updated.code,
      detail: { revision: updated.revision },
    });
    return toPublishedScheme(updated);
  });
}

export async function unpublishScheme(pool: pg.Pool, code: string, adminId: string, reason?: string): Promise<PublishedScheme> {
  return transaction(pool, async client => {
    const scheme = await findScheme(client, code, true);
    if (scheme.publishStatus !== 'published') throw requestError('Scheme is not published', 400);
    const result = await client.query<SchemeRow>(
      `UPDATE schemes SET publish_status = 'unpublished', updated_by = $2, updated_at = now() WHERE code = $1 AND publish_status = 'published' RETURNING ${schemeColumns}`,
      [code, adminId],
    );
    const updated = result.rows[0];
    if (!updated) throw requestError('Scheme is not published', 400);
    await writeAuditLog(client, {
      adminId,
      action: 'scheme.unpublish',
      targetType: 'scheme',
      targetId: updated.code,
      detail: { revision: updated.revision, reason },
    });
    return toPublishedScheme(updated);
  });
}
