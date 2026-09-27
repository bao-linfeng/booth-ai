import type pg from 'pg';
import { transaction } from '../../../infra/database.js';

type DbClient = pg.Pool | pg.PoolClient;

interface SchemeRow {
  id: string;
  code: string;
  revision: number;
  publishStatus: string;
  verificationStatus: string;
  updatedAt: Date | string;
}

export interface ReadinessResult {
  schemeCode: string;
  schemeRevision: number;
  publishStatus: string;
  verificationStatus: string;
  assets: {
    model: { count: number; verified: boolean };
    checklist: { count: number; verified: boolean };
    rendering: { count: number };
    mask: { count: number };
    drawing: { count: number };
    artwork: { count: number };
  };
  blockers: string[];
  canPublish: boolean;
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

interface ReviewRow extends Omit<ReviewRecord, 'createdAt'> {
  createdAt: Date | string;
}

export interface PublishedScheme {
  id: string;
  code: string;
  revision: number;
  publishStatus: string;
  verificationStatus: string;
  updatedAt: string;
}

const schemeColumns = 'id::text AS id, code, revision, publish_status AS "publishStatus", verification_status AS "verificationStatus", updated_at AS "updatedAt"';
const reviewColumns = 'id::text AS id, scheme_id::text AS "schemeId", request_key AS "requestKey", scheme_revision AS "schemeRevision", phase, decision, checks, notes, admin_id::text AS "adminId", created_at AS "createdAt"';

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
  return { ...row, updatedAt: toIsoString(row.updatedAt) };
}

async function findScheme(client: DbClient, code: string, lock = false): Promise<SchemeRow> {
  const result = await client.query<SchemeRow>(`SELECT ${schemeColumns} FROM schemes WHERE code = $1${lock ? ' FOR UPDATE' : ''}`, [code]);
  const scheme = result.rows[0];
  if (!scheme) throw requestError('Scheme not found', 404);
  return scheme;
}

async function readinessForScheme(client: DbClient, scheme: SchemeRow): Promise<ReadinessResult> {
  const counts = await client.query<{ type: string; count: number }>(
    'SELECT type, count(*)::integer AS count FROM scheme_assets WHERE scheme_id = $1 AND is_active = true GROUP BY type',
    [scheme.id],
  );
  const byType = new Map(counts.rows.map(row => [row.type, row.count]));
  const model = byType.get('model') ?? 0;
  const checklist = byType.get('checklist') ?? 0;
  const rendering = byType.get('rendering') ?? 0;
  const mask = byType.get('mask') ?? 0;
  const bom = await client.query<{ status: string | null }>(
    'SELECT b.status FROM schemes s LEFT JOIN scheme_boms b ON b.scheme_id = s.id WHERE s.id = $1',
    [scheme.id],
  );
  const verified = bom.rows[0]?.status === 'verified';
  const blockers: string[] = [];
  if (scheme.publishStatus === 'published') blockers.push('方案已发布');
  if (rendering < 3) blockers.push('效果图不足3张');
  if (mask < 3) blockers.push('蒙版不足3张');
  if (model === 0) blockers.push('缺少模型文件');
  if (!verified) blockers.push('清单未核验');

  return {
    schemeCode: scheme.code,
    schemeRevision: scheme.revision,
    publishStatus: scheme.publishStatus,
    verificationStatus: scheme.verificationStatus,
    assets: {
      model: { count: model, verified: verified && model > 0 },
      checklist: { count: checklist, verified: verified && checklist > 0 },
      rendering: { count: rendering },
      mask: { count: mask },
      drawing: { count: byType.get('drawing') ?? 0 },
      artwork: { count: byType.get('artwork') ?? 0 },
    },
    blockers,
    canPublish: blockers.length === 0 && scheme.publishStatus !== 'published',
  };
}

export async function getSchemeReadiness(pool: pg.Pool, code: string): Promise<ReadinessResult> {
  const scheme = await findScheme(pool, code);
  return readinessForScheme(pool, scheme);
}

export async function createReview(pool: pg.Pool, code: string, adminId: string | null, input: CreateReviewInput): Promise<ReviewRecord> {
  const scheme = await findScheme(pool, code);
  const previous = await pool.query<ReviewRow>(`SELECT ${reviewColumns} FROM scheme_reviews WHERE request_key = $1`, [input.requestKey]);
  if (previous.rows[0]) return toReviewRecord(previous.rows[0]);
  if (scheme.revision !== input.schemeRevision) throw requestError('Scheme revision conflict', 409);
  const inserted = await pool.query<ReviewRow>(
    `INSERT INTO scheme_reviews (scheme_id, request_key, scheme_revision, phase, decision, checks, notes, admin_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (request_key) DO NOTHING RETURNING ${reviewColumns}`,
    [scheme.id, input.requestKey, input.schemeRevision, input.phase, input.decision, JSON.stringify(input.checks), input.notes ?? null, adminId],
  );
  if (inserted.rows[0]) return toReviewRecord(inserted.rows[0]);
  const existing = await pool.query<ReviewRow>(`SELECT ${reviewColumns} FROM scheme_reviews WHERE request_key = $1`, [input.requestKey]);
  if (!existing.rows[0]) throw requestError('Failed to create review', 500);
  return toReviewRecord(existing.rows[0]);
}

export async function publishScheme(pool: pg.Pool, code: string, adminId: string | null): Promise<PublishedScheme> {
  return transaction(pool, async client => {
    const scheme = await findScheme(client, code, true);
    if (scheme.publishStatus === 'published') throw requestError('Scheme is already published', 409);
    const readiness = await readinessForScheme(client, scheme);
    if (readiness.blockers.length) throw requestError(readiness.blockers[0]!, 400);
    const result = await client.query<SchemeRow>(
      `UPDATE schemes SET publish_status = 'published', updated_by = $2, updated_at = now() WHERE id = $1 RETURNING ${schemeColumns}`,
      [scheme.id, adminId],
    );
    const updated = result.rows[0];
    if (!updated) throw requestError('Scheme not found', 404);
    return toPublishedScheme(updated);
  });
}

export async function unpublishScheme(pool: pg.Pool, code: string, adminId: string | null, reason?: string): Promise<PublishedScheme> {
  const scheme = await findScheme(pool, code);
  if (scheme.publishStatus !== 'published') throw requestError('Scheme is not published', 400);
  const result = await pool.query<SchemeRow>(
    `UPDATE schemes SET publish_status = 'unpublished', updated_by = $2, updated_at = now() WHERE code = $1 AND publish_status = 'published' RETURNING ${schemeColumns}`,
    [code, adminId],
  );
  const updated = result.rows[0];
  if (!updated) throw requestError('Scheme is not published', 400);
  return toPublishedScheme(updated);
}
