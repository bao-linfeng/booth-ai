import type pg from 'pg';
import { createHash } from 'node:crypto';
import type { createStorage } from '../../../infra/storage.js';
import { rulesVersion, type BoothSpace, type Candidate, type Catalog, type Option } from './domain.js';

interface CandidateRow {
  id: string;
  code: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  areaM2: number;
  openingCount: number;
  productSystemId: string;
  styleId: string | null;
  industryIds: string[] | null;
  budgetTierId: string | null;
  zoneIds: string[] | null;
  featureIds: string[] | null;
  keywords: string[] | null;
  conditions: Record<string, unknown> | null;
}

interface AssetRow {
  id: string;
  schemeId: string;
  type: string;
  order: number;
  relatedAssetId: string | null;
  objectKey: string;
  width: number | null;
  height: number | null;
  mime: string;
}

export async function loadCatalog(pool: pg.Pool): Promise<Catalog & { rulesVersion: string; dictionaryVersion: string }> {
  const result = await pool.query<{ type: string; id: string; value: string; label: string }>(`SELECT d.code AS type, i.id::text AS id, i.item_value AS value, i.item_label AS label
    FROM dictionaries d JOIN dictionary_items i ON i.dictionary_id = d.id
    WHERE d.enabled AND i.enabled AND d.code IN ('opening_count','booth_length','booth_width','booth_height','booth_area','product_system','style','industry','budget_tier','functional_zone','key_feature')
    ORDER BY d.code, i.sort_order, i.id`);
  const byType = (type: string, useValue = false): Option[] => result.rows
    .filter(row => row.type === type)
    .map(({ id, value, label }) => ({ id: useValue ? value : id, label }));
  const numericValues = (type: string): number[] => [...new Set(result.rows
    .filter(row => row.type === type)
    .map(row => Number(row.value))
    .filter(value => Number.isFinite(value)))].sort((left, right) => left - right);
  const spaces = await pool.query<{ lengthMm: number; widthMm: number; heightMm: number }>(`
    SELECT DISTINCT length_mm AS "lengthMm", width_mm AS "widthMm", height_mm AS "heightMm"
    FROM schemes
    WHERE length_mm > 0 AND width_mm > 0 AND height_mm > 0
    ORDER BY length_mm, width_mm, height_mm`);
  const boothSpaces: BoothSpace[] = spaces.rows.map(row => ({
    id: `${row.lengthMm}-${row.widthMm}-${row.heightMm}`,
    label: `${row.lengthMm / 1000} × ${row.widthMm / 1000} × ${row.heightMm / 1000} m`,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
  }));
  
  return {
    dimensions: { lengthMm: numericValues('booth_length'), widthMm: numericValues('booth_width'), maxHeightMm: numericValues('booth_height'), areaM2: numericValues('booth_area') },
    boothSpaces,
    openingCounts: byType('opening_count', true),
    productSystems: byType('product_system'),
    styles: byType('style'),
    industries: byType('industry'),
    budgetTiers: byType('budget_tier'),
    zones: byType('functional_zone'),
    features: byType('key_feature'),
    applicabilityQuestions: [], // Currently empty, implement based on specific project needs
    rulesVersion,
    dictionaryVersion: createHash('sha256').update(JSON.stringify(result.rows)).digest('hex').slice(0, 16),
  };
}

export async function loadCandidates(pool: pg.Pool, catalog: Catalog, storage: Pick<ReturnType<typeof createStorage>, 'signDownload'>, code?: string): Promise<Candidate[]> {
  const result = await pool.query<CandidateRow>(`
    SELECT s.id, s.code, s.length_mm AS "lengthMm", s.width_mm AS "widthMm",
      s.height_mm AS "heightMm", s.area_sqm::float8 AS "areaM2", s.opening_count AS "openingCount",
      s.product_system_id::text AS "productSystemId", s.style_id::text AS "styleId",
      s.industry_ids::text[] AS "industryIds", s.budget_tier_id::text AS "budgetTierId", s.zone_ids::text[] AS "zoneIds",
      s.feature_ids::text[] AS "featureIds", s.keywords, s.applicable_conditions AS conditions
    FROM schemes s
    WHERE s.publish_status = 'published'
      AND EXISTS (SELECT 1 FROM scheme_boms b WHERE b.scheme_id = s.id AND b.status = 'verified')
      AND (SELECT r.decision FROM scheme_reviews r WHERE r.scheme_id = s.id AND r.scheme_revision = s.revision
        AND r.phase = 'overall' ORDER BY r.created_at DESC, r.id DESC LIMIT 1) = 'pass'
      AND NOT EXISTS (SELECT 1 FROM scheme_assets a WHERE a.scheme_id = s.id AND a.updated_at >
        (SELECT max(r.created_at) FROM scheme_reviews r WHERE r.scheme_id = s.id AND r.scheme_revision = s.revision AND r.phase = 'overall'))
       AND s.applicable_conditions->>'labelsConfirmed' = 'true'
       AND NOT EXISTS (SELECT 1 FROM unnest(array_remove(ARRAY[s.product_system_id, s.style_id, s.budget_tier_id] || s.industry_ids || s.zone_ids || s.feature_ids, NULL)) AS selected(id)
         LEFT JOIN dictionary_items di ON di.id = selected.id AND di.enabled
         LEFT JOIN dictionaries d ON d.id = di.dictionary_id AND d.enabled WHERE d.id IS NULL)
      ${code === undefined ? '' : 'AND s.code = $1'}
    ORDER BY s.code`, code === undefined ? [] : [code]);
    
  if (!result.rows.length) return [];
  
  const assets = await pool.query<AssetRow>(`
    SELECT a.id, a.scheme_id AS "schemeId", a.type, a.sort_order AS "order", a.related_asset_id AS "relatedAssetId",
      v.object_key AS "objectKey", v.width_px AS width, v.height_px AS height, v.mime_type AS mime
    FROM scheme_assets a
    JOIN LATERAL (SELECT * FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
    WHERE a.scheme_id = ANY($1::uuid[]) AND a.is_active = true AND v.byte_size > 0
    ORDER BY a.scheme_id, a.sort_order, a.id`, [result.rows.map(row => row.id)]);
    
  const candidates: Candidate[] = [];
  
  for (const row of result.rows) {
    if (![row.lengthMm, row.widthMm, row.heightMm].every(value => Number.isSafeInteger(value) && value > 0)) continue;
    if (row.areaM2 !== row.lengthMm * row.widthMm / 1_000_000) continue;
    if (!Number.isInteger(row.openingCount) || row.openingCount < 1 || row.openingCount > 4) continue;
    
    const product = catalog.productSystems.find(option => option.id === row.productSystemId);
    if (!product) continue;
    
    // applicability rules check
    if (row.conditions?.status !== 'confirmed' || !Array.isArray(row.conditions.rules)) continue;
    const rules = row.conditions.rules;
    if (!rules.every((rule: unknown) => !!rule && typeof rule === 'object' && 'id' in rule && typeof rule.id === 'string' && 'expectedValue' in rule && typeof rule.expectedValue === 'boolean')) continue;
    const applicabilityRules = rules as { id: string; expectedValue: boolean }[];
    if (applicabilityRules.some(rule => !catalog.applicabilityQuestions.some(question => question.id === rule.id))) continue;
    
    const bound = assets.rows.filter(asset => asset.schemeId === row.id);
    if (!['model', 'checklist', 'rendering', 'mask', 'drawing', 'artwork'].every(type => bound.some(asset => asset.type === type))) continue;
    
    const images = bound.filter(asset => asset.type === 'rendering');
    const masks = bound.filter(asset => asset.type === 'mask');
    
    if (images.length !== 3 || masks.length !== 3 || new Set(images.map(image => image.objectKey)).size !== 3 || new Set(images.map(image => image.order)).size !== 3) continue;
    if (images.some(image => !image.width || !image.height || image.width * 9 !== image.height * 16 || !/^image\/(png|jpeg|webp)$/.test(image.mime) || masks.filter(mask => mask.relatedAssetId === image.id && mask.width === image.width && mask.height === image.height).length !== 1)) continue;
    
    candidates.push({
      code: row.code,
      specifications: {
        lengthMm: row.lengthMm, widthMm: row.widthMm, heightMm: row.heightMm, areaM2: row.areaM2,
        openingCount: row.openingCount,
        productSystemId: product.id, productSystemLabel: product.label
      },
      images: await Promise.all(images.map(async image => {
        const url = await storage.signDownload(image.objectKey, 300);
        return { assetId: image.id, url, thumbnailUrl: url, order: image.order, width: image.width!, height: image.height! };
      })),
      styleId: row.styleId,
      industryIds: row.industryIds ?? [],
      budgetTierId: row.budgetTierId,
      zoneIds: row.zoneIds ?? [],
      featureIds: row.featureIds ?? [],
      keywords: row.keywords ?? [],
      labelsConfirmed: row.conditions.labelsConfirmed === true,
      applicabilityRules,
      applicabilityNotes: typeof row.conditions.publicNotes === 'string' ? row.conditions.publicNotes : '',
    });
  }
  return candidates;
}
