import type pg from 'pg';
import { sameImageSize, type MaybeImageSize } from '../schemes/image-spec.js';
import type { AssetType, SchemeAsset, UpdateAssetInput } from './types.js';

function requestError(message: string, statusCode: number, reason?: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode }, reason ? { reason } : {});
}

export async function ensureRelatedAsset(client: pg.PoolClient, schemeId: string, relatedAssetId: string | null | undefined): Promise<void> {
  if (!relatedAssetId) return;
  const related = await client.query('SELECT 1 FROM scheme_baseline_assets WHERE id = $1 AND scheme_id = $2', [relatedAssetId, schemeId]);
  if (!related.rowCount) throw requestError('Related asset must belong to the same scheme', 400);
}

export async function ensureMaskRelatedAsset(client: pg.PoolClient, schemeId: string, relatedAssetId: string | null | undefined, assetId?: string): Promise<void> {
  if (!relatedAssetId) return;
  const related = await client.query<{ type: string }>(`
    SELECT type
    FROM scheme_baseline_assets
    WHERE id = $1 AND scheme_id = $2 AND type = 'rendering' AND is_active = true
    FOR UPDATE
  `, [relatedAssetId, schemeId]);
  if (related.rows[0]?.type !== 'rendering') throw requestError('Related asset for a mask must be a rendering', 400);
  const paired = await client.query(`
    SELECT 1
    FROM scheme_baseline_assets
    WHERE scheme_id = $1 AND type = 'mask' AND related_asset_id = $2 AND is_active = true${assetId ? ' AND id <> $3' : ''}
    LIMIT 1
  `, assetId ? [schemeId, relatedAssetId, assetId] : [schemeId, relatedAssetId]);
  if (paired.rowCount) throw requestError('This rendering is already paired with another mask', 409);
}

/** 蒙版像素尺寸必须与配对效果图的当前版本一致；需在已锁定方案的事务内调用。 */
export async function ensureMaskMatchesRendering(
  client: pg.PoolClient,
  renderingId: string | null | undefined,
  mask: MaybeImageSize,
): Promise<void> {
  if (!renderingId) return;
  const result = await client.query<{ widthPx: number | null; heightPx: number | null }>(`
    SELECT width_px AS "widthPx", height_px AS "heightPx"
    FROM asset_versions
    WHERE asset_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [renderingId]);
  const rendering = result.rows[0];
  if (!rendering) throw requestError('Paired rendering has no uploaded file', 400, 'RENDERING_FILE_MISSING');
  if (!sameImageSize(mask, rendering)) throw requestError('Mask size must match its paired rendering', 400, 'MASK_SIZE_MISMATCH');
}

/**
 * 效果图软删除不会触发 related_asset_id 的 ON DELETE SET NULL：未确认时拒绝删除仍有活动蒙版的效果图，
 * 确认后在同一事务内一并删除配对蒙版，避免留下指向失效效果图的活动蒙版。需在已锁定方案的事务内调用。
 */
export async function retirePairedMasks(client: pg.PoolClient, adminId: string | null, schemeId: string, renderingId: string, confirmed: boolean): Promise<void> {
  if (confirmed) {
    await client.query(`
      UPDATE scheme_baseline_assets
      SET is_active = false, revision = revision + 1, updated_by = $1, updated_at = now()
      WHERE scheme_id = $2 AND type = 'mask' AND related_asset_id = $3 AND is_active = true
    `, [adminId, schemeId, renderingId]);
    return;
  }
  const paired = await client.query(`
    SELECT 1 FROM scheme_baseline_assets
    WHERE scheme_id = $1 AND type = 'mask' AND related_asset_id = $2 AND is_active = true
    LIMIT 1
  `, [schemeId, renderingId]);
  if (paired.rowCount) throw requestError('Rendering is paired with an active mask', 409, 'RENDERING_HAS_PAIRED_MASK');
}

export async function resolveSortOrder(
  client: pg.PoolClient,
  schemeId: string,
  type: AssetType,
  relatedAssetId: string | null | undefined,
  sortOrder: number | undefined,
): Promise<number> {
  if (sortOrder !== undefined) return sortOrder;
  if (type === 'mask' && relatedAssetId) {
    const related = await client.query<{ sortOrder: number }>(
      'SELECT sort_order AS "sortOrder" FROM scheme_baseline_assets WHERE id = $1 AND scheme_id = $2',
      [relatedAssetId, schemeId],
    );
    if (related.rows[0]) return related.rows[0].sortOrder;
  }
  const result = await client.query<{ sortOrder: number | null }>(
    'SELECT MAX(sort_order)::integer AS "sortOrder" FROM scheme_baseline_assets WHERE scheme_id = $1 AND type = $2 AND is_active = true',
    [schemeId, type],
  );
  return (result.rows[0]?.sortOrder ?? -1) + 1;
}

async function setAssetSortOrder(client: pg.PoolClient, schemeId: string, assetId: string, sortOrder: number, adminId: string | null): Promise<void> {
  await client.query(`
    UPDATE scheme_baseline_assets
    SET sort_order = $1, revision = revision + 1, updated_by = $2, updated_at = now()
    WHERE id = $3 AND scheme_id = $4 AND is_active = true
  `, [sortOrder, adminId, assetId, schemeId]);
}

async function setPairedMasksSortOrder(client: pg.PoolClient, schemeId: string, renderingId: string, sortOrder: number, adminId: string | null): Promise<void> {
  await client.query(`
    UPDATE scheme_baseline_assets
    SET sort_order = $1, revision = revision + 1, updated_by = $2, updated_at = now()
    WHERE scheme_id = $3 AND type = 'mask' AND related_asset_id = $4 AND is_active = true
  `, [sortOrder, adminId, schemeId, renderingId]);
}

async function synchronizeSortOrder(client: pg.PoolClient, adminId: string | null, asset: SchemeAsset, relatedAssetId: string | null | undefined, sortOrder: number): Promise<void> {
  const renderingId = asset.type === 'rendering' ? asset.id : asset.type === 'mask' ? relatedAssetId : null;
  if (!renderingId) return;
  const duplicateOrder = await client.query<{ id: string }>(`
    SELECT id::text AS id FROM scheme_baseline_assets
    WHERE scheme_id = $1 AND type = 'rendering' AND sort_order = $2
      AND id <> $3 AND is_active = true
    LIMIT 1
  `, [asset.schemeId, sortOrder, renderingId]);
  const displacedRenderingId = duplicateOrder.rows[0]?.id;
  if (displacedRenderingId) {
    await setAssetSortOrder(client, asset.schemeId, displacedRenderingId, asset.sortOrder, adminId);
    await setPairedMasksSortOrder(client, asset.schemeId, displacedRenderingId, asset.sortOrder, adminId);
  }
  if (asset.type === 'mask') {
    await setAssetSortOrder(client, asset.schemeId, renderingId, sortOrder, adminId);
  } else {
    await setPairedMasksSortOrder(client, asset.schemeId, renderingId, sortOrder, adminId);
  }
}

export async function updateAssetPairing(client: pg.PoolClient, adminId: string | null, asset: SchemeAsset, input: UpdateAssetInput): Promise<void> {
  const relatedAssetId = Object.hasOwn(input, 'relatedAssetId') ? input.relatedAssetId : asset.relatedAssetId;
  if (Object.hasOwn(input, 'relatedAssetId')) await ensureRelatedAsset(client, asset.schemeId, relatedAssetId);
  if (asset.type === 'mask') await ensureMaskRelatedAsset(client, asset.schemeId, relatedAssetId, asset.id);
  if (asset.type === 'mask' && asset.currentVersion && relatedAssetId !== asset.relatedAssetId) {
    await ensureMaskMatchesRendering(client, relatedAssetId, asset.currentVersion);
  }
  if (Object.hasOwn(input, 'sortOrder') && input.sortOrder !== undefined) {
    await synchronizeSortOrder(client, adminId, asset, relatedAssetId, input.sortOrder);
  }
}
