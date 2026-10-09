import { createHash } from 'node:crypto';
import type pg from 'pg';
import { domainError } from '../../lib/errors.js';
import { findAsset } from './queries.js';
import type { CreateAssetInput, SchemeAsset } from './types.js';

/** 一次上传操作的幂等键与请求摘要；同键不同内容视为冲突。 */
export interface AssetUploadRequest {
  key: string;
  requestHash: string;
}

export function assetUploadRequest(key: string, input: CreateAssetInput, checksum: string): AssetUploadRequest {
  const requestHash = createHash('sha256').update(JSON.stringify([
    input.type, input.name, input.sortOrder ?? null, input.relatedAssetId ?? null, input.metadata ?? {}, checksum,
  ])).digest('hex');
  return { key, requestHash };
}

/** 在新建资源的同一事务内登记幂等键；并发重试撞键时由主键冲突兜底。 */
export async function recordAssetUploadRequest(client: pg.PoolClient, adminId: string | null, schemeId: string, assetId: string, request: AssetUploadRequest): Promise<void> {
  await client.query(`
    INSERT INTO asset_upload_requests (scheme_id, idempotency_key, request_hash, asset_id, created_by)
    VALUES ($1, $2, $3, $4, $5)
  `, [schemeId, request.key, request.requestHash, assetId, adminId]);
}

export function isUploadKeyCollision(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === '23505' &&
    'constraint' in error && error.constraint === 'asset_upload_requests_pkey';
}

/**
 * 已处理过的同一上传操作：摘要一致时返回首次创建的资源以重放结果，内容不同或资源已被删除时拒绝；
 * 未处理过时返回 null。
 */
export async function findAssetUploadReplay(pool: pg.Pool, schemeCode: string, request: AssetUploadRequest): Promise<SchemeAsset | null> {
  const recorded = await pool.query<{ requestHash: string; assetId: string }>(`
    SELECT r.request_hash AS "requestHash", r.asset_id::text AS "assetId"
    FROM asset_upload_requests r JOIN schemes s ON s.id = r.scheme_id
    WHERE s.code = $1 AND r.idempotency_key = $2
  `, [schemeCode, request.key]);
  const row = recorded.rows[0];
  if (!row) return null;
  const asset = row.requestHash === request.requestHash ? await findAsset(pool, schemeCode, row.assetId) : null;
  if (!asset) throw domainError('UPLOAD_KEY_CONFLICT', 409);
  return asset;
}
