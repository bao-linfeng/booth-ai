import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../infra/database.js';

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
    ORDER BY av.created_at DESC, av.id DESC
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
    FROM scheme_baseline_assets sa
    JOIN schemes s ON s.id = sa.scheme_id
    ${latestVersionJoin}
    WHERE s.code = $1 AND sa.id = $2${activeOnly ? ' AND sa.is_active = true' : ''}
  `, [schemeCode, assetId]);
  const row = result.rows[0];
  return row ? toSchemeAsset(row) : null;
}

async function ensureRelatedAsset(pool: pg.Pool | pg.PoolClient, schemeId: string, relatedAssetId: string | null | undefined): Promise<void> {
  if (!relatedAssetId) return;
  const related = await pool.query('SELECT 1 FROM scheme_baseline_assets WHERE id = $1 AND scheme_id = $2', [relatedAssetId, schemeId]);
  if (!related.rowCount) throw requestError('Related asset must belong to the same scheme', 400);
}

async function ensureMaskRelatedAsset(pool: pg.Pool | pg.PoolClient, schemeId: string, relatedAssetId: string | null | undefined, assetId?: string): Promise<void> {
  if (!relatedAssetId) return;
  const related = await pool.query<{ type: string }>(`
    SELECT type
    FROM scheme_baseline_assets
    WHERE id = $1 AND scheme_id = $2 AND type = 'rendering' AND is_active = true
    FOR UPDATE
  `, [relatedAssetId, schemeId]);
  if (related.rows[0]?.type !== 'rendering') throw requestError('Related asset for a mask must be a rendering', 400);
  const paired = await pool.query(`
    SELECT 1
    FROM scheme_baseline_assets
    WHERE scheme_id = $1 AND type = 'mask' AND related_asset_id = $2 AND is_active = true${assetId ? ' AND id <> $3' : ''}
    LIMIT 1
  `, assetId ? [schemeId, relatedAssetId, assetId] : [schemeId, relatedAssetId]);
  if (paired.rowCount) throw requestError('This rendering is already paired with another mask', 409);
}

async function resolveSortOrder(
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

export async function getAsset(pool: pg.Pool, schemeCode: string, assetId: string): Promise<SchemeAsset> {
  const asset = await findAsset(pool, schemeCode, assetId);
  if (!asset) throw requestError('Asset not found', 404);
  return asset;
}

export async function createAsset(pool: pg.Pool, adminId: string | null, input: CreateAssetInput): Promise<SchemeAsset> {
  const assetId = randomUUID();
  await transaction(pool, async client => {
    const scheme = await client.query<{ id: string }>('SELECT id::text AS id FROM schemes WHERE code = $1 FOR UPDATE', [input.schemeCode]);
    const schemeRow = scheme.rows[0];
    if (!schemeRow) throw requestError('Scheme not found', 404);
    await ensureRelatedAsset(client, schemeRow.id, input.relatedAssetId);
    if (input.type === 'mask') await ensureMaskRelatedAsset(client, schemeRow.id, input.relatedAssetId);
    const sortOrder = await resolveSortOrder(client, schemeRow.id, input.type, input.relatedAssetId, input.sortOrder);
    await client.query(`
      INSERT INTO scheme_baseline_assets (id, scheme_id, type, name, sort_order, related_asset_id, metadata, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [assetId, schemeRow.id, input.type, input.name, sortOrder, input.relatedAssetId ?? null, input.metadata ?? {}, adminId, adminId]);
    await invalidatePublishedScheme(client, schemeRow.id, adminId);
  });
  const asset = await findAsset(pool, input.schemeCode, assetId);
  if (!asset) throw requestError('Failed to create asset', 500);
  return asset;
}

export async function createAssetWithVersion(
  pool: pg.Pool,
  adminId: string | null,
  input: CreateAssetInput,
  versionInput: UploadVersionInput,
): Promise<SchemeAsset> {
  return transaction(pool, async client => {
    const scheme = await client.query<{ id: string }>('SELECT id::text AS id FROM schemes WHERE code = $1 FOR UPDATE', [input.schemeCode]);
    const schemeRow = scheme.rows[0];
    if (!schemeRow) throw requestError('Scheme not found', 404);
    if (input.relatedAssetId) {
      await ensureRelatedAsset(client, schemeRow.id, input.relatedAssetId);
    }
    if (input.type === 'mask' && input.relatedAssetId) {
      await ensureMaskRelatedAsset(client, schemeRow.id, input.relatedAssetId);
    }

    const assetId = randomUUID();
    const sortOrder = await resolveSortOrder(client, schemeRow.id, input.type, input.relatedAssetId, input.sortOrder);
    await client.query(`
      INSERT INTO scheme_baseline_assets (id, scheme_id, type, name, sort_order, related_asset_id, metadata, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [assetId, schemeRow.id, input.type, input.name, sortOrder, input.relatedAssetId ?? null, input.metadata ?? {}, adminId, adminId]);
    await client.query(`
      INSERT INTO asset_versions (id, asset_id, object_key, original_filename, mime_type, byte_size, checksum, width_px, height_px, page_count, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [randomUUID(), assetId, versionInput.objectKey, versionInput.originalFilename, versionInput.mimeType,
      versionInput.byteSize, versionInput.checksum, versionInput.widthPx ?? null, versionInput.heightPx ?? null,
      versionInput.pageCount ?? null, adminId]);
    await invalidatePublishedScheme(client, schemeRow.id, adminId);
    const asset = await findAsset(client, input.schemeCode, assetId);
    if (!asset) throw requestError('Failed to create asset', 500);
    return asset;
  });
}

export async function addAssetVersion(pool: pg.Pool, adminId: string | null, schemeCode: string, assetId: string, versionInput: UploadVersionInput, expectedRevision: number): Promise<AssetVersion> {
  return transaction(pool, async client => {
    const schemeLock = await client.query<{ id: string }>('SELECT id::text AS id FROM schemes WHERE code=$1 FOR UPDATE', [schemeCode]);
    if (!schemeLock.rows[0]) throw requestError('Scheme not found', 404);
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
      UPDATE scheme_baseline_assets SET revision = revision + 1, updated_by = $1, updated_at = now()
      WHERE id = $2 AND revision = $3 AND is_active = true
    `, [adminId, assetId, expectedRevision]);
    if (!updated.rowCount) throw requestError('Asset revision conflict', 409);
    await invalidatePublishedScheme(client, schemeLock.rows[0].id, adminId);
    return toAssetVersion(version);
  });
}

export async function updateAsset(pool: pg.Pool, adminId: string | null, schemeCode: string, assetId: string, input: UpdateAssetInput, expectedRevision: number): Promise<SchemeAsset> {
  await transaction(pool, async client => {
    const schemeLock = await client.query<{ id: string }>('SELECT id::text AS id FROM schemes WHERE code=$1 FOR UPDATE',[schemeCode]);
    if (!schemeLock.rows[0]) throw requestError('Scheme not found',404);
    const asset = await findAsset(client, schemeCode, assetId);
    if (!asset) throw requestError('Asset not found', 404);
    const relatedAssetId = Object.hasOwn(input, 'relatedAssetId') ? input.relatedAssetId : asset.relatedAssetId;
    if (Object.hasOwn(input, 'relatedAssetId')) await ensureRelatedAsset(client, asset.schemeId, relatedAssetId);
    if (asset.type === 'mask') await ensureMaskRelatedAsset(client, asset.schemeId, relatedAssetId, assetId);
    if (Object.hasOwn(input, 'sortOrder') && input.sortOrder !== undefined) {
      if (asset.type === 'rendering' || (asset.type === 'mask' && relatedAssetId)) {
        const pairedRenderingId = asset.type === 'rendering' ? asset.id : relatedAssetId;
        const duplicateOrder = await client.query<{ id: string }>(`
          SELECT id::text AS id FROM scheme_baseline_assets
          WHERE scheme_id = $1 AND type = 'rendering' AND sort_order = $2
            AND id <> $3 AND is_active = true
          LIMIT 1
        `, [asset.schemeId, input.sortOrder, pairedRenderingId]);
        const displacedRenderingId = duplicateOrder.rows[0]?.id;
        if (displacedRenderingId) {
          await client.query(`
            UPDATE scheme_baseline_assets
            SET sort_order = $1, revision = revision + 1, updated_by = $2, updated_at = now()
            WHERE id = $3 AND scheme_id = $4 AND is_active = true
          `, [asset.sortOrder, adminId, displacedRenderingId, asset.schemeId]);
          await client.query(`
            UPDATE scheme_baseline_assets
            SET sort_order = $1, revision = revision + 1, updated_by = $2, updated_at = now()
            WHERE scheme_id = $3 AND type = 'mask' AND related_asset_id = $4 AND is_active = true
          `, [asset.sortOrder, adminId, asset.schemeId, displacedRenderingId]);
        }
        if (asset.type === 'mask') {
          await client.query(`
            UPDATE scheme_baseline_assets
            SET sort_order = $1, revision = revision + 1, updated_by = $2, updated_at = now()
            WHERE id = $3 AND scheme_id = $4 AND is_active = true
          `, [input.sortOrder, adminId, pairedRenderingId, asset.schemeId]);
        }
      }
      if (asset.type === 'mask' && relatedAssetId) {
        await client.query(`
          UPDATE scheme_baseline_assets
          SET sort_order = $1, revision = revision + 1, updated_by = $2, updated_at = now()
          WHERE id = $3 AND scheme_id = $4 AND is_active = true
        `, [input.sortOrder, adminId, relatedAssetId, asset.schemeId]);
      } else if (asset.type === 'rendering') {
        await client.query(`
          UPDATE scheme_baseline_assets
          SET sort_order = $1, revision = revision + 1, updated_by = $2, updated_at = now()
          WHERE scheme_id = $3 AND type = 'mask' AND related_asset_id = $4 AND is_active = true
        `, [input.sortOrder, adminId, asset.schemeId, asset.id]);
      }
    }
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
      const current = await findAsset(client, schemeCode, assetId);
      if (!current) throw requestError('Asset not found', 404);
      throw requestError('Asset revision conflict', 409);
    }
    await invalidatePublishedScheme(client, schemeLock.rows[0].id, adminId);
  });
  return getAsset(pool, schemeCode, assetId);
}

export async function deleteAsset(pool: pg.Pool, adminId: string | null, schemeCode: string, assetId: string, expectedRevision: number): Promise<number> {
  if ((await getAsset(pool, schemeCode, assetId)).type === 'model') {
    return transaction(pool, async client => {
      const scheme = await client.query<{ id: string }>('SELECT id::text AS id FROM schemes WHERE code=$1 FOR UPDATE', [schemeCode]);
      if (!scheme.rows[0]) throw requestError('Scheme not found', 404);
      const result = await client.query<{ revision: number }>('UPDATE scheme_baseline_assets SET is_active=false,revision=revision+1,updated_by=$1,updated_at=now() WHERE id=$2 AND scheme_id=$3 AND revision=$4 AND is_active=true RETURNING revision', [adminId, assetId, scheme.rows[0].id, expectedRevision]);
      if (!result.rows[0]) throw requestError('Asset revision conflict', 409);
      await invalidatePublishedScheme(client, scheme.rows[0].id, adminId);
      return result.rows[0].revision;
    });
  }
  return transaction(pool, async client => {
    const scheme = await client.query<{ id: string }>('SELECT id::text AS id FROM schemes WHERE code=$1 FOR UPDATE', [schemeCode]);
    if (!scheme.rows[0]) throw requestError('Scheme not found', 404);
    const asset = await findAsset(client, schemeCode, assetId);
    if (!asset) throw requestError('Asset not found', 404);
    const result = await client.query<{ revision: number }>(`
      UPDATE scheme_baseline_assets SET is_active = false, revision = revision + 1, updated_by = $1, updated_at = now()
      WHERE id = $2 AND revision = $3 AND is_active = true RETURNING revision
    `, [adminId, assetId, expectedRevision]);
    if (!result.rows[0]) throw requestError('Asset revision conflict', 409);
    await invalidatePublishedScheme(client, scheme.rows[0].id, adminId);
    return result.rows[0].revision;
  });
}

async function invalidatePublishedScheme(client: pg.PoolClient, schemeId: string, adminId: string | null): Promise<void> {
  await client.query(`UPDATE schemes SET publish_status='draft', verification_status='unverified', revision=revision+1,
    updated_by=$2, updated_at=now() WHERE id=$1 AND publish_status='published'`, [schemeId, adminId]);
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
