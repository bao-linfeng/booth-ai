import type pg from 'pg';
import { getBom } from '../admin/bill-of-materials/service.js';
import { projectError, type QuoteInput } from './domain.js';
import { loadCandidatePool, loadCatalog } from '../client/selection/repository.js';
import { matchSchemes } from '../client/selection/match.js';
import { isEmpty, validateRequirement } from '../client/selection/domain.js';

export interface AssetSnapshot {
  assetId: string; versionId: string; type: string; name: string; revision: number; objectKey: string;
  checksum: string; filename: string; mimeType: string; metadata: Record<string, unknown>;
}
export interface BomSnapshotItem {
  id: string; ordinal: number; productName: string; productModel: string | null; specificationMm: string | null;
  quantity: string; pricingUnit: string; erpCode: string | null;
}
export interface SchemeSnapshot {
  code: string; name: string; revision: number; lengthMm: number; widthMm: number; heightMm: number;
  openingCount: number; selectedTheme: (NonNullable<QuoteInput['themeSelection']> & { asset: AssetSnapshot }) | null;
  renderings: AssetSnapshot[];
}
export interface MaterialsSnapshot {
  bom: { status: string; revision: number | null; contentHash: string | null; verifiedAt: string | null; items: BomSnapshotItem[] };
  drawings: { status: string; revision: number | null; assets: AssetSnapshot[] };
  artworks: { status: string; revision: number | null; assets: AssetSnapshot[] };
}
export async function captureScheme(client: pg.PoolClient, input: Pick<QuoteInput, 'schemeCode' | 'schemeRevision' | 'bomRevision' | 'drawingRevision' | 'artworkRevision' | 'themeSelection' | 'requirementContext'>, userId: string | null) {
  const scheme = (await client.query<Omit<SchemeSnapshot, 'selectedTheme' | 'renderings'> & { id: string; publishStatus: string }>(
    `SELECT id,code,name,revision,length_mm AS "lengthMm",width_mm AS "widthMm",height_mm AS "heightMm",opening_count AS "openingCount",publish_status AS "publishStatus"
     FROM schemes WHERE code=$1 FOR NO KEY UPDATE`, [input.schemeCode])).rows[0];
  if (!scheme || scheme.publishStatus !== 'published') throw projectError('SCHEME_UNAVAILABLE');
  if (input.schemeRevision !== undefined && input.schemeRevision !== scheme.revision) throw projectError('SCHEME_REVISION_CHANGED');
  const catalog = await loadCatalog(client);
  const { candidates } = await loadCandidatePool(client,catalog,{ signDownload: async () => '' },scheme.code);
  if (!candidates.length) throw projectError('SCHEME_UNAVAILABLE');
  await client.query('SELECT id FROM scheme_boms WHERE scheme_id=$1 FOR UPDATE', [scheme.id]);
  const bom = await getBom(client, scheme.code);
  if (input.bomRevision !== undefined && (bom?.status !== 'verified' || bom.revision !== input.bomRevision)) throw projectError('BOM_REVISION_CHANGED');
  const assets = (await client.query<AssetSnapshot>(`SELECT a.id AS "assetId",a.type,a.name,a.revision,a.metadata,
    v.id AS "versionId",v.object_key AS "objectKey",v.checksum,v.original_filename AS filename,v.mime_type AS "mimeType"
    FROM scheme_assets a JOIN LATERAL (SELECT * FROM asset_versions WHERE asset_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
    WHERE a.scheme_id=$1 AND a.is_active AND v.byte_size>0 AND NOT (a.metadata ? 'themeJobId') ORDER BY a.sort_order,a.id`, [scheme.id])).rows;
  if (!bom || bom.status !== 'verified' || !['model','checklist','rendering','mask','drawing','artwork'].every(type => assets.some(asset => asset.type === type))) throw projectError('SCHEME_UNAVAILABLE');
  if (input.themeSelection && input.artworkRevision !== undefined) throw projectError('INVALID_INPUT',400);
  const drawings = assets.filter(asset => asset.type === 'drawing');
  const artworks = assets.filter(asset => asset.type === 'artwork');
  if (input.drawingRevision !== undefined && input.drawingRevision !== scheme.revision) throw projectError('DRAWING_REVISION_CHANGED');
  if (input.artworkRevision !== undefined && input.artworkRevision !== scheme.revision) throw projectError('ARTWORK_REVISION_CHANGED');
  let selectedTheme: SchemeSnapshot['selectedTheme'] = null;
  if (input.themeSelection) {
    const selection = input.themeSelection;
    const job = (await client.query<{ resultId: string; revision: number; status: string }>(`SELECT selected_result_id AS "resultId",selection_revision AS revision,status
      FROM theme_jobs WHERE id=$1 AND user_id=$2 AND scheme_code=$3 FOR UPDATE`, [selection.themeJobId, userId, scheme.code])).rows[0];
    if (!job || !['succeeded','partially_succeeded'].includes(job.status) || job.resultId !== selection.resultId || job.revision !== selection.selectionRevision) throw projectError('THEME_SELECTION_CHANGED');
    const asset = (await client.query<AssetSnapshot>(`SELECT a.id AS "assetId",a.type,a.name,a.revision,a.metadata,
      v.id AS "versionId",v.object_key AS "objectKey",v.checksum,v.original_filename AS filename,v.mime_type AS "mimeType"
      FROM theme_job_results r JOIN scheme_assets a ON a.id=r.asset_id
      JOIN LATERAL (SELECT * FROM asset_versions WHERE asset_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
      WHERE r.id=$1 AND r.job_id=$2 AND v.byte_size>0`, [selection.resultId, selection.themeJobId])).rows[0];
    if (!asset) throw projectError('THEME_SELECTION_CHANGED');
    selectedTheme = { ...selection, asset };
  }
  const materials: MaterialsSnapshot = {
    bom: { status: 'available', revision: bom.revision, contentHash: bom.contentHash, verifiedAt: bom.verifiedAt,
      items: bom.items.map(item => ({ id: item.id, ordinal: item.ordinal, productName: item.productName, productModel: item.productModel,
        specificationMm: item.specificationMm, quantity: item.quantity, pricingUnit: item.measurementKind === 'length' ? 'm' : item.measurementKind === 'area' ? 'm²' : item.sourceUnit, erpCode: item.erpCode })) },
    drawings: { status: drawings.length ? 'available' : 'missing', revision: drawings.length ? scheme.revision : null, assets: drawings },
    artworks: { status: selectedTheme ? 'pending' : artworks.length ? 'available' : 'missing', revision: selectedTheme ? null : scheme.revision, assets: selectedTheme ? [] : artworks },
  };
  const snapshot: SchemeSnapshot = { code: scheme.code, name: scheme.name, revision: scheme.revision, lengthMm: scheme.lengthMm, widthMm: scheme.widthMm,
    heightMm: scheme.heightMm, openingCount: scheme.openingCount, selectedTheme, renderings: assets.filter(asset => asset.type === 'rendering') };
  const requirement = input.requirementContext ? validateRequirement(input.requirementContext.confirmedRequirements,catalog) : null;
  const match = requirement ? matchSchemes(candidates,requirement,isEmpty(requirement) ? 'random' : 'filtered',false).items[0] : null;
  const matchingSummary = requirement ? { matchType: match?.matchType ?? 'unmatched', differences: match?.differences ?? [],
    pendingConfirmations: match?.pendingConfirmations ?? ['该方案未满足当前确认条件，需人工重新核对适用性'] } : null;
  return { snapshot, materials, matchingSummary, versions: [...assets, ...(selectedTheme ? [selectedTheme.asset] : [])].map(asset => asset.versionId) };
}
