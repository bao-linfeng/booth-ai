import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../../infra/database.js';
import { bomError } from './errors.js';
import { persistContentHash, saveItems } from './items.js';
import { findBom, schemeByCode } from './repository.js';
import { assertBomEditable, audit, digest, iso, unpublish } from './support.js';
import type { BomImportRecord, CommitResult } from './types.js';
import type { ParsedBom } from './workbook.js';

interface ImportRow extends Omit<BomImportRecord, 'expiresAt'> {
  expiresAt: Date | string;
}

const IMPORT_MAPPING_REVISION = 5;

const importColumns = `
  i.id::text AS id,
  i.scheme_id::text AS "schemeId",
  i.source_hash AS "sourceHash",
  i.source_filename AS "sourceFilename",
  i.source_object_key AS "sourceObjectKey",
  i.source_byte_size AS "sourceByteSize",
  i.base_revision AS "baseRevision",
  i.mapping_revision AS "mappingRevision",
  i.preview,
  i.errors,
  i.warnings,
  i.can_commit AS "canCommit",
  i.status,
  i.committed_revision AS "committedRevision",
  i.commit_request_hash AS "commitRequestHash",
  i.committed_result AS "committedResult",
  i.expires_at AS "expiresAt"
`;
const importReturning = importColumns.replaceAll('i.', '');

function importRecord(row: ImportRow): BomImportRecord {
  const expired = row.status === 'ready' && new Date(row.expiresAt).getTime() <= Date.now();
  return { ...row, expiresAt: iso(row.expiresAt) ?? '', status: expired ? 'expired' : row.status };
}

function xlsxMimeType(filename: string): string {
  return filename.toLowerCase().endsWith('.xlsm')
    ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

export async function assertImportBaseline(pool: pg.Pool, schemeCode: string, expected: number): Promise<void> {
  const scheme = await schemeByCode(pool, schemeCode);
  const bom = await findBom(pool, scheme.id);
  if ((bom?.revision ?? 0) !== expected) throw bomError('BOM_REVISION_CHANGED', 409);
  assertBomEditable(bom);
}

export async function createBomImport(
  pool: pg.Pool,
  adminId: string,
  schemeCode: string,
  filename: string,
  sourceHash: string,
  objectKey: string,
  byteSize: number,
  baseRevision: number,
  preview: ParsedBom,
): Promise<BomImportRecord> {
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) throw bomError('INVALID_INPUT', 400);
  return transaction(pool, async client => {
    const scheme = await schemeByCode(client, schemeCode, true);
    const bom = await findBom(client, scheme.id);
    if ((bom?.revision ?? 0) !== baseRevision) throw bomError('BOM_REVISION_CHANGED', 409);
    assertBomEditable(bom);
    const canCommit = preview.errors.length === 0 && preview.items.length > 0;
    const row = (await client.query<ImportRow>(
      `INSERT INTO bom_imports (
         scheme_id, created_by, source_hash, source_filename, source_object_key, source_byte_size,
         base_revision, preview, errors, warnings, can_commit, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${importReturning}`,
      [
        scheme.id, adminId, sourceHash, filename, objectKey, byteSize, baseRevision,
        JSON.stringify(preview), JSON.stringify(preview.errors), JSON.stringify(preview.warnings),
        canCommit, canCommit ? 'ready' : 'invalid',
      ],
    )).rows[0];
    if (!row) throw bomError('INTERNAL_ERROR', 500);
    return importRecord(row);
  });
}

export async function getBomImport(pool: pg.Pool, schemeCode: string, importId: string): Promise<BomImportRecord> {
  const row = (await pool.query<ImportRow>(
    `SELECT ${importColumns} FROM bom_imports i JOIN schemes s ON s.id = i.scheme_id WHERE s.code = $1 AND i.id = $2`,
    [schemeCode, importId],
  )).rows[0];
  if (!row) throw bomError('RESOURCE_NOT_FOUND', 404);
  return importRecord(row);
}

/** 创建或重置清单主记录，返回清单 id；调用方已确认修订号与可编辑状态。 */
async function prepareBomForImport(client: pg.PoolClient, schemeId: string, existingId: string | undefined, adminId: string): Promise<string> {
  const bomId = existingId ?? randomUUID();
  if (existingId) {
    await client.query('DELETE FROM scheme_bom_items WHERE bom_id = $1', [bomId]);
    await client.query(
      "UPDATE scheme_boms SET revision = revision + 1, status = 'pending_verification', source_asset_id = NULL, verified_at = NULL, updated_by = $2, updated_at = now() WHERE id = $1",
      [bomId, adminId],
    );
  } else {
    await client.query('INSERT INTO scheme_boms (id, scheme_id, created_by, updated_by) VALUES ($1, $2, $3, $3)', [bomId, schemeId, adminId]);
  }
  return bomId;
}

/** 把导入的源 Excel 登记为方案基线资产（checklist 类型）并返回资产 id。 */
async function createSourceAsset(client: pg.PoolClient, schemeId: string, row: ImportRow, objectKey: string, byteSize: number, adminId: string): Promise<string> {
  const source = await client.query<{ id: string }>(
    "INSERT INTO scheme_baseline_assets (scheme_id, type, name, is_active, created_by, updated_by) VALUES ($1, 'checklist', $2, true, $3, $3) RETURNING id::text AS id",
    [schemeId, row.sourceFilename, adminId],
  );
  const sourceId = source.rows[0]?.id;
  if (!sourceId) throw bomError('INTERNAL_ERROR', 500);
  await client.query(
    `INSERT INTO asset_versions (asset_id, object_key, original_filename, mime_type, byte_size, checksum, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sourceId, objectKey, row.sourceFilename, xlsxMimeType(row.sourceFilename), byteSize, row.sourceHash, adminId],
  );
  return sourceId;
}

export async function createOrReplaceBomFromImport(
  pool: pg.Pool,
  adminId: string,
  schemeCode: string,
  importId: string,
  expected: number,
): Promise<CommitResult> {
  const requestHash = digest([expected]);
  const result = await transaction(pool, async client => {
    const scheme = await schemeByCode(client, schemeCode, true);
    const row = (await client.query<ImportRow>(
      `SELECT ${importColumns} FROM bom_imports i WHERE i.id = $1 AND i.scheme_id = $2 FOR UPDATE`,
      [importId, scheme.id],
    )).rows[0];
    if (!row) throw bomError('RESOURCE_NOT_FOUND', 404);
    if (row.status === 'committed') {
      if (row.commitRequestHash !== requestHash || !row.committedResult) throw bomError('IDEMPOTENCY_CONFLICT', 409);
      return row.committedResult;
    }
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      await client.query("UPDATE bom_imports SET status = 'expired' WHERE id = $1", [importId]);
      return null;
    }
    if (row.status === 'expired') throw bomError('IMPORT_EXPIRED', 410);
    if (!row.canCommit || row.status !== 'ready' || row.errors.length || row.mappingRevision !== IMPORT_MAPPING_REVISION) {
      throw bomError('IMPORT_NOT_READY', 409);
    }
    if (expected !== row.baseRevision) throw bomError('BOM_REVISION_CHANGED', 409);
    const old = await findBom(client, scheme.id);
    if ((old?.revision ?? 0) !== expected) throw bomError('BOM_REVISION_CHANGED', 409);
    assertBomEditable(old);
    const bomId = await prepareBomForImport(client, scheme.id, old?.id, adminId);
    if (!row.sourceObjectKey || row.sourceByteSize === null) throw bomError('IMPORT_NOT_READY', 409);
    const sourceId = await createSourceAsset(client, scheme.id, row, row.sourceObjectKey, row.sourceByteSize, adminId);
    await client.query('UPDATE scheme_boms SET source_asset_id = $1 WHERE id = $2', [sourceId, bomId]);
    await saveItems(client, { id: bomId, items: [] }, row.preview.items);
    await persistContentHash(client, scheme.id);
    const unpublished = await unpublish(client, scheme, adminId);
    const committed: CommitResult = {
      schemeCode,
      revision: expected + 1,
      status: 'pending_verification',
      itemCount: row.preview.items.length,
      unpublished,
    };
    await client.query(
      "UPDATE bom_imports SET status = 'committed', committed_revision = $1, commit_request_hash = $2, committed_result = $3 WHERE id = $4",
      [committed.revision, requestHash, JSON.stringify(committed), importId],
    );
    await audit(client, bomId, expected, 'import', '导入方案清单', adminId, {
      importId,
      itemCount: committed.itemCount,
      sourceHash: row.sourceHash,
    });
    return committed;
  });
  if (!result) throw bomError('IMPORT_EXPIRED', 410);
  return result;
}
