import type pg from 'pg';
import { isRenderingAspect } from '../assets/image-spec.js';

type DbClient = pg.Pool | pg.PoolClient;

export type BlockerCode =
  | 'VERIFICATION_FAILED'
  | 'RENDERING_COUNT'
  | 'MASK_COUNT'
  | 'RENDERING_MASK_MISMATCH'
  | 'MISSING_MODEL'
  | 'MISSING_CHECKLIST'
  | 'MISSING_DRAWING'
  | 'MISSING_ARTWORK'
  | 'BOM_NOT_VERIFIED'
  | 'ASSET_NOT_READY'
  | 'DIMENSION_INCOMPLETE'
  | 'OPENING_COUNT_INVALID'
  | 'PRODUCT_SYSTEM_UNMAPPED'
  | 'INVALID_TAGS'
  | 'NO_OVERALL_REVIEW'
  | 'ASSETS_CHANGED_AFTER_REVIEW';

export const BLOCKER_MESSAGES: Record<BlockerCode, string> = {
  VERIFICATION_FAILED: '方案核验失败',
  RENDERING_COUNT: '必须恰好有3张效果图',
  MASK_COUNT: '必须恰好有3张蒙版',
  RENDERING_MASK_MISMATCH: '效果图与蒙版未逐一配对或图片规格不符',
  MISSING_MODEL: '缺少模型文件',
  MISSING_CHECKLIST: '缺少清单资产',
  MISSING_DRAWING: '缺少三视图资产',
  MISSING_ARTWORK: '缺少平面素材资产',
  BOM_NOT_VERIFIED: '清单未核验',
  ASSET_NOT_READY: '资产版本未就绪',
  DIMENSION_INCOMPLETE: '方案尺寸或面积不完整',
  OPENING_COUNT_INVALID: '开口面数未核对',
  PRODUCT_SYSTEM_UNMAPPED: '产品体系未映射到可用字典',
  INVALID_TAGS: '方案标签含停用或失效字典项',
  NO_OVERALL_REVIEW: '缺少当前修订的整体审核通过记录',
  ASSETS_CHANGED_AFTER_REVIEW: '审核后资产发生变化',
} satisfies Record<BlockerCode, string>;

const REVIEW_BLOCKER_CODES = new Set<BlockerCode>(['NO_OVERALL_REVIEW', 'ASSETS_CHANGED_AFTER_REVIEW']);

export interface SchemeReadiness {
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
  blockers: BlockerCode[];
  /** 不含 NO_OVERALL_REVIEW / ASSETS_CHANGED_AFTER_REVIEW，供创建整体审核时使用 */
  coreBlockers: BlockerCode[];
  /** 内容和审核均通过，且方案未发布，可执行发布操作 */
  canPublish: boolean;
  /** 内容和审核均通过，且方案已发布，可加入候选池 */
  canSelect: boolean;
}

export interface SchemeReadinessData {
  scheme: {
    code: string;
    revision: number;
    publishStatus: string;
    verificationStatus: string;
    lengthMm: number | null;
    widthMm: number | null;
    heightMm: number | null;
    areaM2: string | null;
    openingCount: number | null;
    productSystemId: string | null;
  };
  assets: Array<{
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
  }>;
  bomVerified: boolean;
  lastOverallReview: { decision: string; createdAt: Date | string } | null;
  productSystemExists: boolean;
  hasInvalidTags: boolean;
}

export interface SchemeRow {
  id: string;
  code: string;
  revision: number;
  publishStatus: string;
  verificationStatus: string;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  areaM2: string | null;
  openingCount: number | null;
  productSystemId: string | null;
}

const imageMimeRe = /^image\/(png|jpeg|webp)$/;

export function evaluateReadiness(data: SchemeReadinessData): SchemeReadiness {
  const { scheme, assets, bomVerified, lastOverallReview, productSystemExists, hasInvalidTags } = data;

  const byType = new Map<string, number>();
  for (const asset of assets) byType.set(asset.type, (byType.get(asset.type) ?? 0) + 1);
  const modelCount = byType.get('model') ?? 0;
  const checklistCount = byType.get('checklist') ?? 0;
  const renderingCount = byType.get('rendering') ?? 0;
  const maskCount = byType.get('mask') ?? 0;

  const blockers: BlockerCode[] = [];

  if (scheme.verificationStatus === 'failed') blockers.push('VERIFICATION_FAILED');
  if (renderingCount !== 3) blockers.push('RENDERING_COUNT');
  if (maskCount !== 3) blockers.push('MASK_COUNT');
  if (modelCount === 0) blockers.push('MISSING_MODEL');
  if (checklistCount === 0) blockers.push('MISSING_CHECKLIST');
  if (!byType.get('drawing')) blockers.push('MISSING_DRAWING');
  if (!byType.get('artwork')) blockers.push('MISSING_ARTWORK');
  if (!bomVerified) blockers.push('BOM_NOT_VERIFIED');

  if (assets.some(asset => !asset.objectKey || !asset.byteSize || Number(asset.byteSize) <= 0)) {
    blockers.push('ASSET_NOT_READY');
  }

  // 效果图与蒙版配对检查（仅在数量正确时才有意义）
  if (renderingCount === 3 && maskCount === 3) {
    const images = assets.filter(a => a.type === 'rendering');
    const masks = assets.filter(a => a.type === 'mask');
    const sortOrdersUnique = new Set(images.map(i => i.sortOrder)).size === 3;
    const objectKeysUnique = new Set(images.map(i => i.objectKey)).size === 3;
    const pairingValid = images.every(image =>
      image.widthPx && image.heightPx &&
      isRenderingAspect(image.widthPx, image.heightPx) &&
      imageMimeRe.test(image.mimeType ?? '') &&
      masks.filter(mask =>
        mask.relatedAssetId === image.id &&
        mask.sortOrder === image.sortOrder &&
        mask.widthPx === image.widthPx &&
        mask.heightPx === image.heightPx &&
        imageMimeRe.test(mask.mimeType ?? ''),
      ).length === 1,
    );
    if (!sortOrdersUnique || !objectKeysUnique || !pairingValid) {
      blockers.push('RENDERING_MASK_MISMATCH');
    }
  }

  // 尺寸与面积
  const { lengthMm, widthMm, heightMm } = scheme;
  const dimensionsValid = [lengthMm, widthMm, heightMm].every(
    v => v !== null && Number.isSafeInteger(v) && v > 0,
  );
  if (!dimensionsValid || scheme.areaM2 === null ||
    Number(scheme.areaM2) !== (lengthMm ?? 0) * (widthMm ?? 0) / 1_000_000) {
    blockers.push('DIMENSION_INCOMPLETE');
  }

  if (!scheme.openingCount || scheme.openingCount < 1 || scheme.openingCount > 4) {
    blockers.push('OPENING_COUNT_INVALID');
  }

  if (!productSystemExists) blockers.push('PRODUCT_SYSTEM_UNMAPPED');
  if (hasInvalidTags) blockers.push('INVALID_TAGS');

  // 审核有效性
  if (lastOverallReview?.decision !== 'pass') {
    blockers.push('NO_OVERALL_REVIEW');
  } else if (assets.some(asset => new Date(asset.updatedAt).getTime() > new Date(lastOverallReview.createdAt).getTime())) {
    blockers.push('ASSETS_CHANGED_AFTER_REVIEW');
  }

  const coreBlockers = blockers.filter(code => !REVIEW_BLOCKER_CODES.has(code));

  return {
    schemeCode: scheme.code,
    schemeRevision: scheme.revision,
    publishStatus: scheme.publishStatus,
    verificationStatus: scheme.verificationStatus,
    assets: {
      model: { count: modelCount, verified: bomVerified && modelCount > 0 },
      checklist: { count: checklistCount, verified: bomVerified && checklistCount > 0 },
      rendering: { count: renderingCount },
      mask: { count: maskCount },
      drawing: { count: byType.get('drawing') ?? 0 },
      artwork: { count: byType.get('artwork') ?? 0 },
    },
    blockers,
    coreBlockers,
    canPublish: scheme.publishStatus !== 'published' && blockers.length === 0,
    canSelect: scheme.publishStatus === 'published' && blockers.length === 0,
  };
}

export async function loadAndEvaluate(client: DbClient, scheme: SchemeRow): Promise<SchemeReadiness> {
  const assetRows = await client.query<SchemeReadinessData['assets'][number]>(`
    SELECT a.id::text AS id, a.type, a.sort_order AS "sortOrder",
      a.related_asset_id::text AS "relatedAssetId", a.updated_at AS "updatedAt",
      v.width_px AS "widthPx", v.height_px AS "heightPx",
      v.mime_type AS "mimeType", v.byte_size::text AS "byteSize", v.object_key AS "objectKey"
    FROM scheme_baseline_assets a
    LEFT JOIN LATERAL (
      SELECT width_px, height_px, mime_type, byte_size, object_key
      FROM asset_versions WHERE asset_id = a.id
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) v ON true
    WHERE a.scheme_id = $1 AND a.is_active = true`, [scheme.id]);

  const bom = await client.query<{ status: string | null }>(
    'SELECT b.status FROM schemes s LEFT JOIN scheme_boms b ON b.scheme_id = s.id WHERE s.id = $1',
    [scheme.id],
  );
  const bomVerified = bom.rows[0]?.status === 'verified';

  const review = await client.query<{ decision: string; createdAt: Date | string }>(
    `SELECT decision, created_at AS "createdAt" FROM scheme_reviews
     WHERE scheme_id = $1 AND scheme_revision = $2 AND phase = 'overall'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [scheme.id, scheme.revision],
  );
  const lastOverallReview = review.rows[0] ?? null;

  const product = scheme.productSystemId
    ? await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM dictionary_items i
           JOIN dictionaries d ON d.id = i.dictionary_id
           WHERE d.code = 'product_system' AND d.enabled AND i.enabled AND i.id = $1
         ) AS exists`,
        [scheme.productSystemId],
      )
    : null;
  const productSystemExists = product?.rows[0]?.exists === true;

  const invalidTags = await client.query<{ invalid: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM schemes s
      CROSS JOIN LATERAL unnest(array_remove(
        ARRAY[s.product_system_id, s.style_id, s.budget_tier_id]
        || s.industry_ids || s.zone_ids || s.feature_ids, NULL
      )) tag(id)
      LEFT JOIN dictionary_items i ON i.id = tag.id AND i.enabled
      LEFT JOIN dictionaries d ON d.id = i.dictionary_id AND d.enabled
      WHERE s.id = $1 AND d.id IS NULL
    ) AS invalid`, [scheme.id]);
  const hasInvalidTags = invalidTags.rows[0]?.invalid === true;

  return evaluateReadiness({
    scheme,
    assets: assetRows.rows,
    bomVerified,
    lastOverallReview,
    productSystemExists,
    hasInvalidTags,
  });
}

export async function getSchemeReadiness(pool: pg.Pool, code: string): Promise<SchemeReadiness> {
  const result = await pool.query<SchemeRow>(
    `SELECT id::text AS id, code, revision,
       publish_status AS "publishStatus",
       verification_status AS "verificationStatus",
       length_mm AS "lengthMm", width_mm AS "widthMm", height_mm AS "heightMm",
       area_sqm::text AS "areaM2", opening_count AS "openingCount",
       product_system_id::text AS "productSystemId"
     FROM schemes WHERE code = $1`,
    [code],
  );
  const scheme = result.rows[0];
  if (!scheme) {
    const err = new Error('Scheme not found');
    Object.assign(err, { statusCode: 404 });
    throw err;
  }
  return loadAndEvaluate(pool, scheme);
}
