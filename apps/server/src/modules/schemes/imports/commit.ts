import { createHash } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../../infra/database.js';
import { domainError } from '../../../lib/errors.js';
import { validateSchemeDictionaryIds } from '../dictionary-ids.js';
import { findSchemesByCodes } from '../service.js';
import { ensureSelectionSizes } from '../../dictionaries/sizes.js';
import { importRowChanges, onlyNotesChanged } from './changes.js';
import type { CommitImportOptions, CommitImportResult, ImportPreviewRow, ImportRow } from './types.js';
import { importRowFromJson, validateImportedSize } from './validation.js';

const insertSql = `
  INSERT INTO schemes (
    code, name, parent_code, width_mm, length_mm, area_sqm, height_mm,
    opening_count, product_system_id, style_id, industry_ids, budget_tier_id,
    zone_ids, feature_ids, description, keywords,
    notes, created_by, updated_by
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19
  )
`;

const updateSql = `
  UPDATE schemes SET
    name = $2,
    parent_code = $3,
    width_mm = $4,
    length_mm = $5,
    area_sqm = $6,
    height_mm = $7,
    opening_count = $8,
    product_system_id = $9,
    style_id = $10,
    industry_ids = $11,
    budget_tier_id = $12,
    zone_ids = $13,
    feature_ids = $14,
    description = $15,
    keywords = $16,
    notes = $17,
    updated_by = $18,
    updated_at = now(),
    revision = revision + 1,
    verification_status = 'unverified',
    publish_status = CASE WHEN publish_status = 'published' THEN 'draft' ELSE publish_status END
  WHERE code = $1 AND revision = $19
  RETURNING id
`;

// 仅改内部备注：与手动编辑一致，不递增修订、不重置核验、不下架
const notesSql = `
  UPDATE schemes SET notes = $2, updated_by = $3, updated_at = now()
  WHERE code = $1 AND revision = $4
`;

type RowOutcome = { kind: 'created' | 'updated' | 'unchanged' } | { kind: 'failed'; reason: string };

interface ImportRecord {
  preview: unknown;
  status: string;
  commit_request_hash: string | null;
  committed_result: CommitImportResult | null;
}

function mapDbError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes('parent_code') || msg.includes('foreign key')) return '母方案不存在';
    if (msg.includes('schemes_code_key') || msg.includes('unique')) return '方案编号已存在';
  }
  return '数据库写入失败';
}

function failureReason(error: unknown): string {
  return error instanceof Error && 'statusCode' in error && error.statusCode === 400 ? error.message : mapDbError(error);
}

function failedSource(row: ImportPreviewRow): Omit<CommitImportResult['failed'][number], 'reason'> {
  return { rowId: row.rowId, sheetName: row.sheetName, rowNumber: row.rowNumber, code: row.code };
}

/** insert / update 共用的 $1–$17 业务字段，其后依次追加各自的审计与版本参数。 */
function schemeValues(data: ImportRow): unknown[] {
  return [
    data.code,
    data.name,
    data.parentCode,
    data.widthMm,
    data.lengthMm,
    data.areaM2,
    data.heightMm,
    data.openingCount,
    data.productSystemId,
    data.styleId,
    data.industryIds ?? [],
    data.budgetTierId,
    data.zoneIds ?? [],
    data.featureIds ?? [],
    data.description,
    data.keywords,
    data.notes,
  ];
}

/** 锁定待提交的导入记录；同一 importId 已提交时按请求摘要重放结果或报冲突。 */
async function lockPendingImport(
  client: pg.PoolClient,
  importId: string,
  requestHash: string,
): Promise<{ replay: CommitImportResult } | { preview: unknown[] }> {
  const imported = await client.query<ImportRecord>(
    `
    SELECT preview, status, commit_request_hash, committed_result
    FROM scheme_imports
    WHERE id = $1 AND expires_at > now()
    FOR UPDATE
  `,
    [importId],
  );
  const record = imported.rows[0];
  if (!record) throw domainError('IMPORT_PREVIEW_EXPIRED', 410);
  if (record.status === 'committed') {
    if (record.commit_request_hash === requestHash && record.committed_result) return { replay: record.committed_result };
    throw domainError('IMPORT_ALREADY_COMMITTED', 409);
  }
  if (record.status !== 'pending') throw domainError('IMPORT_PREVIEW_EXPIRED', 410);
  if (!Array.isArray(record.preview)) throw domainError('IMPORT_PREVIEW_INVALID', 400);
  return { preview: record.preview };
}

/** 待写入的行：仅 valid / duplicate，受 selectedRowIds 与重复策略过滤；预览时已无差异的行只计数不写入。 */
function rowsToCommit(
  preview: unknown[],
  options: CommitImportOptions,
): { rows: (ImportPreviewRow & { data: ImportRow })[]; unchanged: number } {
  const selectedRowIds = options.selectedRowIds && options.selectedRowIds.length > 0 ? new Set(options.selectedRowIds) : null;
  const rows: (ImportPreviewRow & { data: ImportRow })[] = [];
  let unchanged = 0;
  for (const stored of preview) {
    const row = importRowFromJson(stored);
    if (!row || !row.data || row.status === 'error') continue;
    if (selectedRowIds !== null && !selectedRowIds.has(row.rowId)) continue;
    if (row.status === 'unchanged') {
      unchanged += 1;
      continue;
    }
    if (row.status === 'duplicate' && options.duplicateStrategy === 'skip') continue;
    rows.push({ ...row, data: row.data });
  }
  return { rows, unchanged };
}

/** 覆盖已有方案：锁定后按预览版本校验，再与当前内容比较，无差异不写入，仅改备注不触发下架。 */
async function overwriteRow(
  client: pg.PoolClient,
  adminId: string | null,
  row: ImportPreviewRow & { data: ImportRow },
): Promise<RowOutcome> {
  if (row.snapshotRevision == null) return { kind: 'failed', reason: '预览数据缺少版本信息' };
  const [current] = await findSchemesByCodes(client, [row.code], true);
  if (!current || current.editRevision !== row.snapshotRevision) return { kind: 'failed', reason: '方案已被他人修改，请重新导入' };
  const { changedFields } = importRowChanges(current, row.data);
  if (changedFields.length === 0) return { kind: 'unchanged' };
  const updated = onlyNotesChanged(changedFields)
    ? await client.query(notesSql, [row.code, row.data.notes, adminId, row.snapshotRevision])
    : await client.query(updateSql, [...schemeValues(row.data), adminId, row.snapshotRevision]);
  return updated.rowCount === 0 ? { kind: 'failed', reason: '方案已被他人修改，请重新导入' } : { kind: 'updated' };
}

async function writeRow(client: pg.PoolClient, adminId: string | null, row: ImportPreviewRow & { data: ImportRow }): Promise<RowOutcome> {
  validateImportedSize(row.data);
  await validateSchemeDictionaryIds(client, row.data);
  if (row.status === 'valid') {
    await client.query(insertSql, [...schemeValues(row.data), adminId, adminId]);
    return { kind: 'created' };
  }
  return overwriteRow(client, adminId, row);
}

export async function commitImport(
  pool: pg.Pool,
  adminId: string | null,
  importId: string,
  options: CommitImportOptions,
): Promise<CommitImportResult> {
  return transaction(pool, async client => {
    const requestHash = createHash('sha256')
      .update(JSON.stringify([importId, options.duplicateStrategy, options.selectedRowIds ?? null]))
      .digest('hex');
    const locked = await lockPendingImport(client, importId, requestHash);
    if ('replay' in locked) return locked.replay;

    const { rows, unchanged } = rowsToCommit(locked.preview, options);
    const result: CommitImportResult = { created: 0, updated: 0, unchanged, dictionaryItemsCreated: 0, failed: [] };
    const committedRows: ImportRow[] = [];
    // 每行独立 SAVEPOINT：单行失败只回滚该行，整批仍在同一事务内提交。
    for (const row of rows) {
      await client.query('SAVEPOINT row_save');
      try {
        const outcome = await writeRow(client, adminId, row);
        await client.query('RELEASE SAVEPOINT row_save');
        if (outcome.kind === 'failed') {
          result.failed.push({ ...failedSource(row), reason: outcome.reason });
          continue;
        }
        result[outcome.kind] += 1;
        if (outcome.kind !== 'unchanged') committedRows.push(row.data);
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT row_save');
        result.failed.push({ ...failedSource(row), reason: failureReason(error) });
      }
    }
    result.dictionaryItemsCreated = await ensureSelectionSizes(client, committedRows);
    await client.query(
      "UPDATE scheme_imports SET status = 'committed', committed_at = now(), commit_request_hash = $2, committed_result = $3 WHERE id = $1",
      [importId, requestHash, JSON.stringify(result)],
    );
    return result;
  });
}
