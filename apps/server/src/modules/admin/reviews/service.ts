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
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  areaM2: string | null;
  openingCount: number | null;
  openSides: string[] | null;
  productSystemId: string | null;
  applicableConditions: Record<string, unknown> | null;
}

interface AssetState {
  id: string;
  type: string;
  sortOrder: number;
  relatedAssetId: string | null;
  widthPx: number | null;
  heightPx: number | null;
  mimeType: string | null;
  byteSize: string | null;
  objectKey: string | null;
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

const schemeColumns = 'id::text AS id, code, revision, publish_status AS "publishStatus", verification_status AS "verificationStatus", updated_at AS "updatedAt", length_mm AS "lengthMm", width_mm AS "widthMm", height_mm AS "heightMm", area_sqm::text AS "areaM2", opening_count AS "openingCount", opening_directions AS "openSides", product_system_id::text AS "productSystemId", applicable_conditions AS "applicableConditions"';
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
  const assets = await client.query<AssetState>(`
    SELECT a.id::text AS id, a.type, a.sort_order AS "sortOrder", a.related_asset_id::text AS "relatedAssetId",
      a.updated_at AS "updatedAt", v.width_px AS "widthPx", v.height_px AS "heightPx",
      v.mime_type AS "mimeType", v.byte_size::text AS "byteSize", v.object_key AS "objectKey"
    FROM scheme_assets a
    LEFT JOIN LATERAL (SELECT width_px, height_px, mime_type, byte_size, object_key FROM asset_versions
      WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
    WHERE a.scheme_id = $1 AND a.is_active = true`, [scheme.id]);
  const byType = new Map<string, number>();
  for (const asset of assets.rows) byType.set(asset.type, (byType.get(asset.type) ?? 0) + 1);
  const model = byType.get('model') ?? 0;
  const checklist = byType.get('checklist') ?? 0;
  const rendering = byType.get('rendering') ?? 0;
  const mask = byType.get('mask') ?? 0;
  const bom = await client.query<{ status: string | null }>(
    'SELECT b.status FROM schemes s LEFT JOIN scheme_boms b ON b.scheme_id = s.id WHERE s.id = $1',
    [scheme.id],
  );
  const verified = bom.rows[0]?.status === 'verified';
  const review = await client.query<{ decision: string; createdAt: Date | string }>(
    `SELECT decision, created_at AS "createdAt" FROM scheme_reviews
     WHERE scheme_id = $1 AND scheme_revision = $2 AND phase = 'overall'
     ORDER BY created_at DESC, id DESC LIMIT 1`, [scheme.id, scheme.revision]);
  const lastReview = review.rows[0];
  const blockers: string[] = [];
  if (scheme.publishStatus === 'published') blockers.push('方案已发布');
  if (scheme.verificationStatus === 'failed') blockers.push('方案核验失败');
  if (rendering !== 3) blockers.push('必须恰好有3张效果图');
  if (mask !== 3) blockers.push('必须恰好有3张蒙版');
  if (model === 0) blockers.push('缺少模型文件');
  if (checklist === 0) blockers.push('缺少清单资产');
  if (!byType.get('drawing')) blockers.push('缺少三视图资产');
  if (!byType.get('artwork')) blockers.push('缺少平面素材资产');
  if (!verified) blockers.push('清单未核验');
  if (assets.rows.some(asset => !asset.objectKey || !asset.byteSize || Number(asset.byteSize) <= 0)) blockers.push('资产版本未就绪');
  const images = assets.rows.filter(asset => asset.type === 'rendering');
  const masks = assets.rows.filter(asset => asset.type === 'mask');
  if (images.length === 3 && (new Set(images.map(image => image.sortOrder)).size !== 3 ||
    new Set(images.map(image => image.objectKey)).size !== 3 ||
    images.some(image => !image.widthPx || !image.heightPx || image.widthPx * 9 !== image.heightPx * 16 || !/^image\/(png|jpeg|webp)$/.test(image.mimeType ?? '') ||
      masks.filter(mask => mask.relatedAssetId === image.id && mask.widthPx === image.widthPx && mask.heightPx === image.heightPx && /^image\/(png|jpeg|webp)$/.test(mask.mimeType ?? '')).length !== 1))) blockers.push('效果图与蒙版未逐一配对或图片规格不符');
  const lengthMm = scheme.lengthMm;
  const widthMm = scheme.widthMm;
  const heightMm = scheme.heightMm;
  if (scheme.areaM2 === null || ![lengthMm, widthMm, heightMm].every(value => value !== null && Number.isSafeInteger(value) && value > 0) ||
    Number(scheme.areaM2) !== (lengthMm ?? 0) * (widthMm ?? 0) / 1_000_000) blockers.push('方案尺寸或面积不完整');
  const directions = scheme.openSides;
  if (!scheme.openingCount || scheme.openingCount < 1 || scheme.openingCount > 4 ||
    !Array.isArray(directions) || directions.length !== scheme.openingCount ||
    new Set(directions).size !== directions.length || directions.some(side => !['front', 'right', 'back', 'left'].includes(side))) blockers.push('开口方向未核对');
  const product = scheme.productSystemId ? await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id WHERE d.code = 'product_system' AND d.enabled AND i.enabled AND i.id = $1) AS exists", [scheme.productSystemId]) : null;
  if (!product?.rows[0]?.exists) blockers.push('产品体系未映射到可用字典');
  const invalidTags = await client.query<{ invalid: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM schemes s CROSS JOIN LATERAL unnest(array_remove(
      ARRAY[s.product_system_id, s.style_id, s.budget_tier_id] || s.industry_ids || s.zone_ids || s.feature_ids, NULL)) tag(id)
    LEFT JOIN dictionary_items i ON i.id = tag.id AND i.enabled
    LEFT JOIN dictionaries d ON d.id = i.dictionary_id AND d.enabled
    WHERE s.id = $1 AND d.id IS NULL
  ) AS invalid`, [scheme.id]);
  if (invalidTags.rows[0]?.invalid) blockers.push('方案标签含停用或失效字典项');
  const conditions = scheme.applicableConditions;
  if (conditions?.status !== 'confirmed' || !Array.isArray(conditions.rules) ||
    !conditions.rules.every((rule: unknown) => rule !== null && typeof rule === 'object' &&
      'id' in rule && typeof rule.id === 'string' && 'expectedValue' in rule && typeof rule.expectedValue === 'boolean')) blockers.push('适用条件未确认');
  else if (conditions.rules.length > 0) blockers.push('受控适用问题尚未配置');
  if (conditions?.labelsConfirmed !== true) blockers.push('方案标签未核对');
  if (lastReview?.decision !== 'pass') blockers.push('缺少当前修订的整体审核通过记录');
  else if (assets.rows.some(asset => new Date(asset.updatedAt).getTime() > new Date(lastReview.createdAt).getTime())) blockers.push('审核后资产发生变化');

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
  return transaction(pool, async client => {
    const scheme = await findScheme(client, code, true);
    const previous = await client.query<ReviewRow>(`SELECT ${reviewColumns} FROM scheme_reviews WHERE request_key = $1`, [input.requestKey]);
    if (previous.rows[0]) return toReviewRecord(previous.rows[0]);
    if (scheme.revision !== input.schemeRevision) throw requestError('Scheme revision conflict', 409);
    if (input.phase === 'overall' && input.decision === 'pass') {
      if (!['assetsComplete', 'bomVerified', 'renderingsAndMasks', 'drawingsComplete'].every(key => input.checks[key] === true))
        throw requestError('Overall review checks must all pass', 400);
      const readiness = await readinessForScheme(client, scheme);
      const blockers = readiness.blockers.filter(blocker => blocker !== '缺少当前修订的整体审核通过记录' && blocker !== '审核后资产发生变化');
      if (blockers.length) throw requestError(blockers[0]!, 400);
    }
    const inserted = await client.query<ReviewRow>(
      `INSERT INTO scheme_reviews (scheme_id, request_key, scheme_revision, phase, decision, checks, notes, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (request_key) DO NOTHING RETURNING ${reviewColumns}`,
      [scheme.id, input.requestKey, input.schemeRevision, input.phase, input.decision, JSON.stringify(input.checks), input.notes ?? null, adminId],
    );
    if (inserted.rows[0]) return toReviewRecord(inserted.rows[0]);
    const existing = await client.query<ReviewRow>(`SELECT ${reviewColumns} FROM scheme_reviews WHERE request_key = $1`, [input.requestKey]);
    if (!existing.rows[0]) throw requestError('Failed to create review', 500);
    return toReviewRecord(existing.rows[0]);
  });
}

export async function publishScheme(pool: pg.Pool, code: string, adminId: string | null): Promise<PublishedScheme> {
  return transaction(pool, async client => {
    const scheme = await findScheme(client, code, true);
    if (scheme.publishStatus === 'published') throw requestError('Scheme is already published', 409);
    const readiness = await readinessForScheme(client, scheme);
    if (readiness.blockers.length) throw requestError(readiness.blockers[0]!, 400);
    const result = await client.query<SchemeRow>(
      `UPDATE schemes SET publish_status = 'published', verification_status = 'verified', updated_by = $2, updated_at = now() WHERE id = $1 RETURNING ${schemeColumns}`,
      [scheme.id, adminId],
    );
    const updated = result.rows[0];
    if (!updated) throw requestError('Scheme not found', 404);
    return toPublishedScheme(updated);
  });
}

export async function unpublishScheme(pool: pg.Pool, code: string, adminId: string | null, reason?: string): Promise<PublishedScheme> {
  return transaction(pool, async client => {
    const scheme = await findScheme(client, code, true);
    if (scheme.publishStatus !== 'published') throw requestError('Scheme is not published', 400);
    const result = await client.query<SchemeRow>(
      `UPDATE schemes SET publish_status = 'unpublished', updated_by = $2, updated_at = now() WHERE code = $1 AND publish_status = 'published' RETURNING ${schemeColumns}`,
      [code, adminId],
    );
    const updated = result.rows[0];
    if (!updated) throw requestError('Scheme is not published', 400);
    return toPublishedScheme(updated);
  });
}
