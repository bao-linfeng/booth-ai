import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type pg from 'pg';
import type { createStorage } from '../../infra/storage.js';
import { signImage } from '../media/links.js';
import type { Renditions } from '../media/renditions.js';

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
  renditions: Renditions | null;
  versionId: string;
  checksum: string;
}

interface DeliverableSetRow {
  assetId: string;
  name: string;
  sortOrder: number;
  assetRevision: number;
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  objectKey: string | null;
  versionId: string | null;
  checksum: string | null;
  renditions: Renditions | null;
}

export function deliverableError(statusCode: number, reason?: string): Error & { statusCode: number; reason?: string } {
  return Object.assign(new Error('Scheme deliverable unavailable'), { statusCode, ...(reason ? { reason } : {}) });
}

function isReady(row: DeliverableSetRow): row is DeliverableSetRow & DeliverableRow {
  return (
    !!row.versionId &&
    !!row.objectKey &&
    !!row.originalFilename &&
    !!row.mimeType &&
    row.byteSize !== null &&
    row.byteSize > 0 &&
    !!row.checksum
  );
}

export async function getDeliverableSet(
  pool: pg.Pool,
  code: string,
  type: DeliverableType,
): Promise<{ revision: string; rows: DeliverableSetRow[] }> {
  await assertPublished(pool, code);
  const result = await pool.query<DeliverableSetRow>(
    `
    SELECT a.id::text AS "assetId", a.name, a.sort_order AS "sortOrder", a.revision AS "assetRevision",
      v.original_filename AS "originalFilename", v.mime_type AS "mimeType",
      v.byte_size::float8 AS "byteSize", v.object_key AS "objectKey", v.id::text AS "versionId", v.checksum, v.renditions
    FROM schemes s
    JOIN scheme_baseline_assets a ON a.scheme_id = s.id AND a.is_active = true AND a.type = $2
    LEFT JOIN LATERAL (
      SELECT id, object_key, original_filename, mime_type, byte_size, checksum, renditions
      FROM asset_versions WHERE asset_id = a.id
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) v ON true
    WHERE s.code = $1 AND s.publish_status = 'published'
    ORDER BY a.sort_order, a.created_at, a.id
  `,
    [code, type],
  );
  // 衍生图由 Worker 异步补齐，不属于资料内容，不参与摘要，否则补齐前后打包下载会误判资料已变
  const revision = createHash('sha256')
    .update(JSON.stringify([code, type, result.rows.map(({ renditions: _renditions, ...row }) => row)]))
    .digest('hex');
  return { revision, rows: result.rows };
}

export async function listDeliverables(pool: pg.Pool, code: string, type: DeliverableType): Promise<DeliverableRow[]> {
  const set = await getDeliverableSet(pool, code, type);
  return set.rows.filter(isReady);
}

const PREVIEWABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** 图片资料附带缩略图地址，列表一次拿全，不再逐张请求签名。 */
export function publicDeliverables(
  storage: Pick<ReturnType<typeof createStorage>, 'signDownload'>,
  rows: DeliverableSetRow[],
): Promise<Array<Deliverable & { thumbnailUrl: string | null }>> {
  return Promise.all(
    rows.filter(isReady).map(async ({ assetId, name, originalFilename, mimeType, byteSize, sortOrder, objectKey, renditions }) => ({
      assetId,
      name,
      originalFilename,
      mimeType,
      byteSize,
      sortOrder,
      thumbnailUrl: PREVIEWABLE_IMAGE_TYPES.includes(mimeType) ? await signImage(storage, { objectKey, renditions }, 'thumb', 900) : null,
    })),
  );
}

const MAX_ARCHIVE_FILES = 30;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

export async function buildDeliverableArchive(
  pool: pg.Pool,
  storage: Pick<ReturnType<typeof createStorage>, 'getBuffer'>,
  code: string,
  type: 'drawing' | 'artwork',
  expectedRevision: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const set = await getDeliverableSet(pool, code, type);
  if (set.revision !== expectedRevision) throw deliverableError(409, 'DELIVERABLE_REVISION_CHANGED');
  if (!set.rows.length) throw deliverableError(404, 'DELIVERABLES_NOT_FOUND');
  const items = set.rows.filter(isReady);
  if (items.length !== set.rows.length) throw deliverableError(409, 'DELIVERABLES_INCOMPLETE');
  if (items.length > MAX_ARCHIVE_FILES || items.reduce((size, item) => size + item.byteSize, 0) > MAX_ARCHIVE_BYTES) {
    throw deliverableError(413, 'DELIVERABLE_ARCHIVE_TOO_LARGE');
  }
  const names = new Set<string>();
  for (const item of items) {
    const filename = item.originalFilename;
    if (
      /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(filename) ||
      /[. ]$/.test(filename) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) ||
      Buffer.byteLength(filename) > 255
    ) {
      throw deliverableError(409, 'DELIVERABLE_FILENAME_INVALID');
    }
    const normalized = filename.normalize('NFC').toLowerCase();
    if (names.has(normalized)) throw deliverableError(409, 'DELIVERABLE_FILENAME_CONFLICT');
    names.add(normalized);
    if (!Number.isSafeInteger(item.byteSize) || !/^[a-f\d]{64}$/i.test(item.checksum)) {
      throw deliverableError(409, 'DELIVERABLES_INCOMPLETE');
    }
  }
  const zip = new JSZip();
  let buffer: Buffer;
  try {
    for (const item of items) {
      const content = await storage.getBuffer(item.objectKey, item.byteSize);
      if (content.byteLength !== item.byteSize || createHash('sha256').update(content).digest('hex') !== item.checksum.toLowerCase()) {
        throw new Error('Deliverable integrity mismatch');
      }
      zip.file(item.originalFilename, content, { createFolders: false });
    }
    buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  } catch {
    throw deliverableError(503);
  }
  const current = await getDeliverableSet(pool, code, type);
  if (current.revision !== set.revision) throw deliverableError(409, 'DELIVERABLE_REVISION_CHANGED');
  const safeCode = code.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_');
  return { buffer, filename: `${safeCode}@${type === 'drawing' ? '报馆图素材' : '平面素材'}.zip` };
}

export async function assertPublished(pool: pg.Pool, code: string): Promise<void> {
  const result = await pool.query('SELECT 1 FROM schemes WHERE code = $1 AND publish_status = $2', [code, 'published']);
  if (!result.rows.length) throw deliverableError(404);
}

export async function deliverableAvailability(pool: pg.Pool, code: string): Promise<Record<DeliverableType, boolean>> {
  const result = await pool.query<{ type: DeliverableType }>(
    `
    SELECT DISTINCT a.type FROM schemes s
    JOIN scheme_baseline_assets a ON a.scheme_id = s.id AND a.is_active = true
    WHERE s.code = $1 AND s.publish_status = 'published' AND a.type IN ('model', 'drawing', 'artwork')
      AND (SELECT v.byte_size FROM asset_versions v WHERE v.asset_id = a.id
           ORDER BY v.created_at DESC, v.id DESC LIMIT 1) > 0
  `,
    [code],
  );
  const types = new Set(result.rows.map(row => row.type));
  return { model: types.has('model'), drawing: types.has('drawing'), artwork: types.has('artwork') };
}

export async function signDeliverable(
  pool: pg.Pool,
  storage: Pick<ReturnType<typeof createStorage>, 'signDownloadWithName' | 'signDownload'>,
  code: string,
  type: DeliverableType,
  assetId?: string,
  preview = false,
): Promise<{ downloadUrl: string; filename: string; mimeType: string; expiresAt: string }> {
  const items = await listDeliverables(pool, code, type);
  const asset = assetId ? items.find(item => item.assetId === assetId) : items[0];
  if (!asset) throw deliverableError(404);
  if (preview && (type === 'model' || ![...PREVIEWABLE_IMAGE_TYPES, 'application/pdf'].includes(asset.mimeType))) {
    throw deliverableError(415);
  }
  const expiresIn = 60;
  const filename = asset.originalFilename;
  // 图片预览给预览图，PDF 预览与下载给原文件
  const downloadUrl = preview
    ? await signImage(storage, asset, 'preview', expiresIn)
    : await storage.signDownloadWithName(asset.objectKey, filename, expiresIn);
  await assertPublished(pool, code);
  return { downloadUrl, filename, mimeType: asset.mimeType, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}
