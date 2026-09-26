import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../../infra/database.js';

export type AssetType = 'model' | 'checklist' | 'rendering' | 'mask' | 'drawing' | 'artwork';

export interface AssetVersion {
  id: string;
  assetId: string;
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  widthPx: number | null;
  heightPx: number | null;
  pageCount: number | null;
  createdAt: string;
}

export interface SchemeAsset {
  id: string;
  schemeId: string;
  schemeCode: string;
  schemeName: string;
  type: AssetType;
  name: string;
  sortOrder: number;
  relatedAssetId: string | null;
  metadata: Record<string, unknown>;
  isActive: boolean;
  revision: number;
  currentVersion: AssetVersion | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListAssetsOptions {
  page: number;
  pageSize: number;
  type?: AssetType;
  schemeCode?: string;
  schemeName?: string;
}

export interface CreateAssetInput {
  schemeCode: string;
  type: AssetType;
  name: string;
  sortOrder?: number;
  relatedAssetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UploadVersionInput {
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  widthPx?: number | null;
  heightPx?: number | null;
  pageCount?: number | null;
}

export interface UpdateAssetInput {
  name?: string;
  sortOrder?: number;
  relatedAssetId?: string | null;
  metadata?: Record<string, unknown>;
}

interface AssetRow extends Omit<SchemeAsset, 'createdAt' | 'updatedAt' | 'currentVersion'> {
  createdAt: Date | string;
  updatedAt: Date | string;
  versionId: string | null;
  versionAssetId: string | null;
  versionObjectKey: string | null;
  versionOriginalFilename: string | null;
  versionMimeType: string | null;
  versionByteSize: number | string | null;
  versionChecksum: string | null;
  versionWidthPx: number | null;
  versionHeightPx: number | null;
  versionPageCount: number | null;
  versionCreatedAt: Date | string | null;
}

interface AssetVersionRow {
  id: string;
  assetId: string;
  objectKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number | string;
  checksum: string;
  widthPx: number | null;
  heightPx: number | null;
  pageCount: number | null;
  createdAt: Date | string;
}

function requestError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

const assetColumns = `
  sa.id::text AS id, sa.scheme_id::text AS "schemeId", s.code AS "schemeCode", s.name AS "schemeName",
  sa.type, sa.name, sa.sort_order AS "sortOrder", sa.related_asset_id::text AS "relatedAssetId",
  sa.metadata, sa.is_active AS "isActive", sa.revision, sa.created_at AS "createdAt", sa.updated_at AS "updatedAt",
  av.id::text AS "versionId", av.asset_id::text AS "versionAssetId", av.object_key AS "versionObjectKey",
  av.original_filename AS "versionOriginalFilename", av.mime_type AS "versionMimeType",
  av.byte_size AS "versionByteSize", av.checksum AS "versionChecksum", av.width_px AS "versionWidthPx",
  av.height_px AS "versionHeightPx", av.page_count AS "versionPageCount", av.created_at AS "versionCreatedAt"
`;

const latestVersionJoin = `
  LEFT JOIN LATERAL (
    SELECT av.id, av.asset_id, av.object_key, av.original_filename, av.mime_type,
           av.byte_size, av.checksum, av.width_px, av.height_px, av.page_count, av.created_at
    FROM asset_versions av
    WHERE av.asset_id = sa.id
    ORDER BY av.created_at DESC
    LIMIT 1
  ) av ON true
`;

function toAssetVersion(row: AssetVersionRow): AssetVersion {
  return { ...row, byteSize: Number(row.byteSize), createdAt: toIso(row.createdAt) };
}

function toSchemeAsset(row: AssetRow): SchemeAsset {
  const currentVersion = row.versionId === null || row.versionAssetId === null || row.versionObjectKey === null ||
    row.versionOriginalFilename === null || row.versionMimeType === null || row.versionByteSize === null ||
    row.versionChecksum === null || row.versionCreatedAt === null
    ? null
    : {
        id: row.versionId, assetId: row.versionAssetId, objectKey: row.versionObjectKey,
        originalFilename: row.versionOriginalFilename, mimeType: row.versionMimeType,
        byteSize: Number(row.versionByteSize), checksum: row.versionChecksum, widthPx: row.versionWidthPx,
        heightPx: row.versionHeightPx, pageCount: row.versionPageCount, createdAt: toIso(row.versionCreatedAt),
      };
  const { versionId: _versionId, versionAssetId: _versionAssetId, versionObjectKey: _versionObjectKey,
    versionOriginalFilename: _versionOriginalFilename, versionMimeType: _versionMimeType,
    versionByteSize: _versionByteSize, versionChecksum: _versionChecksum, versionWidthPx: _versionWidthPx,
    versionHeightPx: _versionHeightPx, versionPageCount: _versionPageCount, versionCreatedAt: _versionCreatedAt,
    createdAt, updatedAt, ...asset } = row;
  return { ...asset, type: asset.type as AssetType, currentVersion, createdAt: toIso(createdAt), updatedAt: toIso(updatedAt) };
}

async function findAsset(pool: pg.Pool | pg.PoolClient, schemeCode: string, assetId: string, activeOnly = true): Promise<SchemeAsset | null> {
  const result = await pool.query<AssetRow>(`
    SELECT ${assetColumns}
    FROM scheme_assets sa
    JOIN schemes s ON s.id = sa.scheme_id
    ${latestVersionJoin}
    WHERE s.code = $1 AND sa.id = $2${activeOnly ? ' AND sa.is_active = true' : ''}
  `, [schemeCode, assetId]);
  const row = result.rows[0];
  return row ? toSchemeAsset(row) : null;
}

async function ensureRelatedAsset(pool: pg.Pool | pg.PoolClient, schemeId: string, relatedAssetId: string | null | undefined): Promise<void> {
  if (!relatedAssetId) return;
  const related = await pool.query('SELECT 1 FROM scheme_assets WHERE id = $1 AND scheme_id = $2', [relatedAssetId, schemeId]);
  if (!related.rowCount) throw requestError('Related asset must belong to the same scheme', 400);
}

export async function listAssets(pool: pg.Pool, options: ListAssetsOptions): Promise<{ data: SchemeAsset[]; total: number; page: number; pageSize: number }> {
  const conditions = ['sa.is_active = true'];
  const values: unknown[] = [];
  const add = (condition: string, value: unknown) => {
    values.push(value);
    conditions.push(condition.replace('?', `$${values.length}`));
  };
  if (options.type) add('sa.type = ?', options.type);
  if (options.schemeCode) add('s.code ILIKE ?', `%${options.schemeCode}%`);
  if (options.schemeName) add('s.name ILIKE ?', `%${options.schemeName}%`);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const offset = (options.page - 1) * options.pageSize;
  const [records, count] = await Promise.all([
    pool.query<AssetRow>(`
      SELECT ${assetColumns}
      FROM scheme_assets sa
      JOIN schemes s ON s.id = sa.scheme_id
      ${latestVersionJoin}
      ${where}
      ORDER BY sa.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `, [...values, options.pageSize, offset]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM scheme_assets sa JOIN schemes s ON s.id = sa.scheme_id ${where}`, values),
  ]);
  return { data: records.rows.map(toSchemeAsset), total: Number(count.rows[0]?.total ?? 0), page: options.page, pageSize: options.pageSize };
}

export async function listSchemeAssets(pool: pg.Pool, schemeCode: string, type?: AssetType): Promise<SchemeAsset[]> {
  const result = await pool.query<AssetRow>(`
    SELECT ${assetColumns}
    FROM scheme_assets sa
    JOIN schemes s ON s.id = sa.scheme_id
    ${latestVersionJoin}
    WHERE s.code = $1 AND sa.is_active = true${type ? ' AND sa.type = $2' : ''}
    ORDER BY sa.sort_order ASC, sa.created_at ASC
  `, type ? [schemeCode, type] : [schemeCode]);
  return result.rows.map(toSchemeAsset);
}

export async function getAsset(pool: pg.Pool, schemeCode: string, assetId: string): Promise<SchemeAsset> {
  const asset = await findAsset(pool, schemeCode, assetId);
  if (!asset) throw requestError('Asset not found', 404);
  return asset;
}

export async function createAsset(pool: pg.Pool, adminId: string | null, input: CreateAssetInput): Promise<SchemeAsset> {
  const scheme = await pool.query<{ id: string }>('SELECT id::text AS id FROM schemes WHERE code = $1', [input.schemeCode]);
  const schemeRow = scheme.rows[0];
  if (!schemeRow) throw requestError('Scheme not found', 404);
  await ensureRelatedAsset(pool, schemeRow.id, input.relatedAssetId);
  const assetId = randomUUID();
  await pool.query(`
    INSERT INTO scheme_assets (id, scheme_id, type, name, sort_order, related_asset_id, metadata, created_by, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [assetId, schemeRow.id, input.type, input.name, input.sortOrder ?? 0, input.relatedAssetId ?? null, input.metadata ?? {}, adminId, adminId]);
  const asset = await findAsset(pool, input.schemeCode, assetId);
  if (!asset) throw requestError('Failed to create asset', 500);
  return asset;
}

export async function addAssetVersion(pool: pg.Pool, adminId: string | null, schemeCode: string, assetId: string, versionInput: UploadVersionInput, expectedRevision: number): Promise<AssetVersion> {
  return transaction(pool, async client => {
    const asset = await findAsset(client, schemeCode, assetId);
    if (!asset) throw requestError('Asset not found', 404);
    if (asset.revision !== expectedRevision) throw requestError('Asset revision conflict', 409);
    const result = await client.query<AssetVersionRow>(`
      INSERT INTO asset_versions (id, asset_id, object_key, original_filename, mime_type, byte_size, checksum, width_px, height_px, page_count, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id::text AS id, asset_id::text AS "assetId", object_key AS "objectKey", original_filename AS "originalFilename",
                mime_type AS "mimeType", byte_size AS "byteSize", checksum, width_px AS "widthPx", height_px AS "heightPx",
                page_count AS "pageCount", created_at AS "createdAt"
    `, [randomUUID(), assetId, versionInput.objectKey, versionInput.originalFilename, versionInput.mimeType, versionInput.byteSize,
      versionInput.checksum, versionInput.widthPx ?? null, versionInput.heightPx ?? null, versionInput.pageCount ?? null, adminId]);
    const version = result.rows[0];
    if (!version) throw requestError('Failed to create asset version', 500);
    const updated = await client.query(`
      UPDATE scheme_assets SET revision = revision + 1, updated_by = $1, updated_at = now()
      WHERE id = $2 AND revision = $3 AND is_active = true
    `, [adminId, assetId, expectedRevision]);
    if (!updated.rowCount) throw requestError('Asset revision conflict', 409);
    return toAssetVersion(version);
  });
}

export async function updateAsset(pool: pg.Pool, adminId: string | null, schemeCode: string, assetId: string, input: UpdateAssetInput, expectedRevision: number): Promise<SchemeAsset> {
  const asset = await getAsset(pool, schemeCode, assetId);
  if (Object.hasOwn(input, 'relatedAssetId')) await ensureRelatedAsset(pool, asset.schemeId, input.relatedAssetId);
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
  const updated = await pool.query(`UPDATE scheme_assets SET ${updates.join(', ')} WHERE id = $${values.length - 1} AND revision = $${values.length} AND is_active = true`, values);
  if (!updated.rowCount) {
    const current = await findAsset(pool, schemeCode, assetId);
    if (!current) throw requestError('Asset not found', 404);
    throw requestError('Asset revision conflict', 409);
  }
  return getAsset(pool, schemeCode, assetId);
}

export async function deleteAsset(pool: pg.Pool, adminId: string | null, schemeCode: string, assetId: string, expectedRevision: number): Promise<number> {
  const asset = await getAsset(pool, schemeCode, assetId);
  const result = await pool.query<{ revision: number }>(`
    UPDATE scheme_assets
    SET is_active = false, revision = revision + 1, updated_by = $1, updated_at = now()
    WHERE id = $2 AND revision = $3 AND is_active = true
    RETURNING revision
  `, [adminId, assetId, expectedRevision]);
  const row = result.rows[0];
  if (row) return row.revision;
  const current = await findAsset(pool, schemeCode, asset.id);
  if (!current) throw requestError('Asset not found', 404);
  throw requestError('Asset revision conflict', 409);
}

export async function getAssetVersion(pool: pg.Pool, assetId: string, versionId: string): Promise<AssetVersion> {
  const result = await pool.query<AssetVersionRow>(`
    SELECT id::text AS id, asset_id::text AS "assetId", object_key AS "objectKey", original_filename AS "originalFilename",
           mime_type AS "mimeType", byte_size AS "byteSize", checksum, width_px AS "widthPx", height_px AS "heightPx",
           page_count AS "pageCount", created_at AS "createdAt"
    FROM asset_versions
    WHERE id = $1 AND asset_id = $2
  `, [versionId, assetId]);
  const row = result.rows[0];
  if (!row) throw requestError('Asset version not found', 404);
  return toAssetVersion(row);
}
