import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../infra/database.js';
import { invalidatePublication } from '../schemes/publication.js';
import { validateAssetMetadata } from './metadata.js';
import { ensureMaskRelatedAsset, ensureRelatedAsset, resolveSortOrder, updateAssetPairing } from './pairing.js';
import { assetVersionColumns, findAsset, getAsset, toAssetVersion, type AssetVersionRow } from './queries.js';
import type { AssetVersion, CreateAssetInput, SchemeAsset, UpdateAssetInput, UploadVersionInput } from './types.js';

function requestError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

async function lockScheme(client: pg.PoolClient, schemeCode: string): Promise<string> {
  const result = await client.query<{ id: string }>('SELECT id::text AS id FROM schemes WHERE code = $1 FOR UPDATE', [schemeCode]);
  const scheme = result.rows[0];
  if (!scheme) throw requestError('Scheme not found', 404);
  return scheme.id;
}

async function insertAsset(client: pg.PoolClient, adminId: string | null, schemeId: string, assetId: string, input: CreateAssetInput): Promise<void> {
  await ensureRelatedAsset(client, schemeId, input.relatedAssetId);
  if (input.type === 'mask') await ensureMaskRelatedAsset(client, schemeId, input.relatedAssetId);
  const sortOrder = await resolveSortOrder(client, schemeId, input.type, input.relatedAssetId, input.sortOrder);
  await client.query(`
    INSERT INTO scheme_baseline_assets (id, scheme_id, type, name, sort_order, related_asset_id, metadata, created_by, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [assetId, schemeId, input.type, input.name, sortOrder, input.relatedAssetId ?? null, input.metadata ?? {}, adminId, adminId]);
}

async function insertVersion(client: pg.PoolClient, adminId: string | null, assetId: string, input: UploadVersionInput): Promise<AssetVersion> {
  const result = await client.query<AssetVersionRow>(`
    INSERT INTO asset_versions (id, asset_id, object_key, original_filename, mime_type, byte_size, checksum, width_px, height_px, page_count, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING ${assetVersionColumns}
  `, [randomUUID(), assetId, input.objectKey, input.originalFilename, input.mimeType, input.byteSize,
    input.checksum, input.widthPx ?? null, input.heightPx ?? null, input.pageCount ?? null, adminId]);
  const version = result.rows[0];
  if (!version) throw requestError('Failed to create asset version', 500);
  return toAssetVersion(version);
}

export async function createAsset(pool: pg.Pool, adminId: string | null, input: CreateAssetInput): Promise<SchemeAsset> {
  validateAssetMetadata(input.type, input.metadata);
  const assetId = randomUUID();
  await transaction(pool, async client => {
    const schemeId = await lockScheme(client, input.schemeCode);
    await insertAsset(client, adminId, schemeId, assetId, input);
    await invalidatePublication(client, schemeId, adminId);
  });
  const asset = await findAsset(pool, input.schemeCode, assetId);
  if (!asset) throw requestError('Failed to create asset', 500);
  return asset;
}

export async function createAssetWithVersion(pool: pg.Pool, adminId: string | null, input: CreateAssetInput, versionInput: UploadVersionInput): Promise<SchemeAsset> {
  validateAssetMetadata(input.type, input.metadata);
  return transaction(pool, async client => {
    const schemeId = await lockScheme(client, input.schemeCode);
    const assetId = randomUUID();
    await insertAsset(client, adminId, schemeId, assetId, input);
    await insertVersion(client, adminId, assetId, versionInput);
    await invalidatePublication(client, schemeId, adminId);
    const asset = await findAsset(client, input.schemeCode, assetId);
    if (!asset) throw requestError('Failed to create asset', 500);
    return asset;
  });
}

export async function addAssetVersion(pool: pg.Pool, adminId: string | null, schemeCode: string, assetId: string, versionInput: UploadVersionInput, expectedRevision: number): Promise<AssetVersion> {
  return transaction(pool, async client => {
    const schemeId = await lockScheme(client, schemeCode);
    const asset = await getAsset(client, schemeCode, assetId);
    if (asset.revision !== expectedRevision) throw requestError('Asset revision conflict', 409);
    const version = await insertVersion(client, adminId, assetId, versionInput);
    const updated = await client.query(`
      UPDATE scheme_baseline_assets SET revision = revision + 1, updated_by = $1, updated_at = now()
      WHERE id = $2 AND revision = $3 AND is_active = true
    `, [adminId, assetId, expectedRevision]);
    if (!updated.rowCount) throw requestError('Asset revision conflict', 409);
    await invalidatePublication(client, schemeId, adminId);
    return version;
  });
}

export async function updateAsset(pool: pg.Pool, adminId: string | null, schemeCode: string, assetId: string, input: UpdateAssetInput, expectedRevision: number): Promise<SchemeAsset> {
  await transaction(pool, async client => {
    const schemeId = await lockScheme(client, schemeCode);
    const asset = await getAsset(client, schemeCode, assetId);
    if (Object.hasOwn(input, 'metadata')) validateAssetMetadata(asset.type, input.metadata);
    await updateAssetPairing(client, adminId, asset, input);
    const values: unknown[] = [];
    const updates: string[] = [];
    if (Object.hasOwn(input, 'name')) { values.push(input.name); updates.push(`name = $${values.length}`); }
    if (Object.hasOwn(input, 'sortOrder')) { values.push(input.sortOrder); updates.push(`sort_order = $${values.length}`); }
    if (Object.hasOwn(input, 'relatedAssetId')) { values.push(input.relatedAssetId); updates.push(`related_asset_id = $${values.length}`); }
    if (Object.hasOwn(input, 'metadata')) { values.push(input.metadata); updates.push(`metadata = $${values.length}`); }
    if (updates.length === 0) throw requestError('No fields to update', 400);
    values.push(adminId);
    updates.push(`updated_by = $${values.length}`, 'updated_at = now()', 'revision = revision + 1');
    values.push(assetId, expectedRevision);
    const updated = await client.query(`UPDATE scheme_baseline_assets SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND revision = $${values.length} AND is_active = true`, values);
    if (!updated.rowCount) {
      await getAsset(client, schemeCode, assetId);
      throw requestError('Asset revision conflict', 409);
    }
    await invalidatePublication(client, schemeId, adminId);
  });
  return getAsset(pool, schemeCode, assetId);
}

export async function deleteAsset(pool: pg.Pool, adminId: string | null, schemeCode: string, assetId: string, expectedRevision: number): Promise<number> {
  if ((await getAsset(pool, schemeCode, assetId)).type === 'model') {
    return transaction(pool, async client => {
      const schemeId = await lockScheme(client, schemeCode);
      const result = await client.query<{ revision: number }>('UPDATE scheme_baseline_assets SET is_active=false,revision=revision+1,updated_by=$1,updated_at=now() WHERE id=$2 AND scheme_id=$3 AND revision=$4 AND is_active=true RETURNING revision', [adminId, assetId, schemeId, expectedRevision]);
      if (!result.rows[0]) throw requestError('Asset revision conflict', 409);
      await invalidatePublication(client, schemeId, adminId);
      return result.rows[0].revision;
    });
  }
  return transaction(pool, async client => {
    const schemeId = await lockScheme(client, schemeCode);
    await getAsset(client, schemeCode, assetId);
    const result = await client.query<{ revision: number }>(`
      UPDATE scheme_baseline_assets SET is_active = false, revision = revision + 1, updated_by = $1, updated_at = now()
      WHERE id = $2 AND revision = $3 AND is_active = true RETURNING revision
    `, [adminId, assetId, expectedRevision]);
    if (!result.rows[0]) throw requestError('Asset revision conflict', 409);
    await invalidatePublication(client, schemeId, adminId);
    return result.rows[0].revision;
  });
}
