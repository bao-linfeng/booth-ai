import type pg from 'pg';
import type { createStorage } from '../../../infra/storage.js';

export type DeliverableType = 'drawing' | 'artwork' | 'model';

export interface Deliverable {
  assetId: string;
  name: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sortOrder: number;
}

interface DeliverableRow extends Deliverable {
  objectKey: string;
}

export function deliverableError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error('Scheme deliverable unavailable'), { statusCode });
}

export async function listDeliverables(pool: pg.Pool, code: string, type: DeliverableType): Promise<DeliverableRow[]> {
  const result = await pool.query<DeliverableRow>(`
    SELECT a.id::text AS "assetId", a.name, a.sort_order AS "sortOrder",
      v.original_filename AS "originalFilename", v.mime_type AS "mimeType",
      v.byte_size::float8 AS "byteSize", v.object_key AS "objectKey"
    FROM schemes s
    JOIN scheme_assets a ON a.scheme_id = s.id AND a.is_active = true AND a.type = $2 AND NOT (a.metadata ? 'themeJobId')
    JOIN LATERAL (
      SELECT object_key, original_filename, mime_type, byte_size
      FROM asset_versions WHERE asset_id = a.id
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) v ON true
    WHERE s.code = $1 AND s.publish_status = 'published' AND v.byte_size > 0
    ORDER BY a.sort_order, a.created_at, a.id
  `, [code, type]);
  return result.rows;
}

export async function assertPublished(pool: pg.Pool, code: string): Promise<void> {
  const result = await pool.query('SELECT 1 FROM schemes WHERE code = $1 AND publish_status = $2', [code, 'published']);
  if (!result.rows.length) throw deliverableError(404);
}

export async function deliverableAvailability(pool: pg.Pool, code: string): Promise<Record<DeliverableType, boolean>> {
  const result = await pool.query<{ type: DeliverableType }>(`
    SELECT DISTINCT a.type FROM schemes s
    JOIN scheme_assets a ON a.scheme_id = s.id AND a.is_active = true AND NOT (a.metadata ? 'themeJobId')
    WHERE s.code = $1 AND s.publish_status = 'published' AND a.type IN ('model', 'drawing', 'artwork')
      AND (SELECT v.byte_size FROM asset_versions v WHERE v.asset_id = a.id
           ORDER BY v.created_at DESC, v.id DESC LIMIT 1) > 0
  `, [code]);
  const types = new Set(result.rows.map(row => row.type));
  return { model: types.has('model'), drawing: types.has('drawing'), artwork: types.has('artwork') };
}

export async function signDeliverable(
  pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'signDownloadWithName' | 'signDownload'>,
  code: string, type: DeliverableType, assetId?: string, preview = false,
): Promise<{ downloadUrl: string; filename: string; mimeType: string; expiresAt: string }> {
  const items = await listDeliverables(pool, code, type);
  const asset = assetId ? items.find(item => item.assetId === assetId) : items[0];
  if (!asset) throw deliverableError(404);
  if (preview && (type === 'model' || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(asset.mimeType))) {
    throw deliverableError(415);
  }
  const expiresIn = 60;
  const filename = asset.originalFilename;
  const downloadUrl = preview
    ? await storage.signDownload(asset.objectKey, expiresIn)
    : await storage.signDownloadWithName(asset.objectKey, filename, expiresIn);
  await assertPublished(pool, code);
  return { downloadUrl, filename, mimeType: asset.mimeType, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}
