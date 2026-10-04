import type pg from 'pg';
import type { AssetType, AssetVersion, ListAssetsOptions, SchemeAsset } from './types.js';

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

export interface AssetVersionRow extends Omit<AssetVersion, 'byteSize' | 'createdAt'> {
  byteSize: number | string;
  createdAt: Date | string;
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
    ORDER BY av.created_at DESC, av.id DESC
    LIMIT 1
  ) av ON true
`;

export const assetVersionColumns = `
  id::text AS id, asset_id::text AS "assetId", object_key AS "objectKey", original_filename AS "originalFilename",
  mime_type AS "mimeType", byte_size AS "byteSize", checksum, width_px AS "widthPx", height_px AS "heightPx",
  page_count AS "pageCount", created_at AS "createdAt"
`;

export function toAssetVersion(row: AssetVersionRow): AssetVersion {
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
  return { ...asset, currentVersion, createdAt: toIso(createdAt), updatedAt: toIso(updatedAt) };
}

export async function findAsset(pool: pg.Pool | pg.PoolClient, schemeCode: string, assetId: string): Promise<SchemeAsset | null> {
  const result = await pool.query<AssetRow>(`
    SELECT ${assetColumns}
    FROM scheme_baseline_assets sa
    JOIN schemes s ON s.id = sa.scheme_id
    ${latestVersionJoin}
    WHERE s.code = $1 AND sa.id = $2 AND sa.is_active = true
  `, [schemeCode, assetId]);
  const row = result.rows[0];
  return row ? toSchemeAsset(row) : null;
}

export async function listAssets(pool: pg.Pool, options: ListAssetsOptions): Promise<{ data: SchemeAsset[]; total: number; page: number; pageSize: number }> {
  const conditions = ['sa.is_active = true'];
  const values: unknown[] = [];
  const add = (condition: string, value: unknown) => {
    values.push(value);
    conditions.push(condition.replace('?', `$${values.length}`));
  };
  if (options.type) add('sa.type = ?', options.type);
  if (options.allowedTypes) add('sa.type = ANY(?::text[])', options.allowedTypes);
  if (options.schemeCode) add('s.code ILIKE ?', `%${options.schemeCode}%`);
  if (options.schemeName) add('s.name ILIKE ?', `%${options.schemeName}%`);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const offset = (options.page - 1) * options.pageSize;
  const [records, count] = await Promise.all([
    pool.query<AssetRow>(`
      SELECT ${assetColumns}
      FROM scheme_baseline_assets sa
      JOIN schemes s ON s.id = sa.scheme_id
      ${latestVersionJoin}
      ${where}
      ORDER BY s.code ASC, sa.sort_order ASC, sa.created_at ASC, sa.id ASC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `, [...values, options.pageSize, offset]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM scheme_baseline_assets sa JOIN schemes s ON s.id = sa.scheme_id ${where}`, values),
  ]);
  return { data: records.rows.map(toSchemeAsset), total: Number(count.rows[0]?.total ?? 0), page: options.page, pageSize: options.pageSize };
}

export async function listSchemeAssets(pool: pg.Pool, schemeCode: string, type?: AssetType): Promise<SchemeAsset[]> {
  const result = await pool.query<AssetRow>(`
    SELECT ${assetColumns}
    FROM scheme_baseline_assets sa
    JOIN schemes s ON s.id = sa.scheme_id
    ${latestVersionJoin}
    WHERE s.code = $1 AND sa.is_active = true${type ? ' AND sa.type = $2' : ''}
    ORDER BY sa.sort_order ASC, sa.created_at ASC
  `, type ? [schemeCode, type] : [schemeCode]);
  return result.rows.map(toSchemeAsset);
}

export async function getAsset(pool: pg.Pool | pg.PoolClient, schemeCode: string, assetId: string): Promise<SchemeAsset> {
  const asset = await findAsset(pool, schemeCode, assetId);
  if (!asset) throw Object.assign(new Error('Asset not found'), { statusCode: 404 });
  return asset;
}

export async function getAssetVersion(pool: pg.Pool, assetId: string, versionId: string): Promise<AssetVersion> {
  const result = await pool.query<AssetVersionRow>(`
    SELECT ${assetVersionColumns}
    FROM asset_versions
    WHERE id = $1 AND asset_id = $2
  `, [versionId, assetId]);
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error('Asset version not found'), { statusCode: 404 });
  return toAssetVersion(row);
}
