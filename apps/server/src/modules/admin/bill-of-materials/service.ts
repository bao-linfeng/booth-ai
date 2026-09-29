import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../../infra/database.js';
import type { ParsedBom } from './workbook.js';

export type BomStatus = 'pending_verification' | 'verified' | 'rejected';
export type MeasurementKind = 'count' | 'length' | 'area';
export type ImportStatus = 'ready' | 'invalid' | 'committed' | 'expired';
export interface BomItem { id: string; bomId: string; ordinal: number; productName: string; productModel: string | null; specificationMm: string | null; sourceQuantity: string; sourceUnit: string; measurementKind: MeasurementKind; quantity: string; erpCode: string | null; unitPrice: string | null; totalPrice: string | null; totalWeightKg: string | null; sourceSheet: string | null; sourceRow: number | null; diffNote: string | null }
export interface BomRecord { id: string; schemeId: string; revision: number; status: BomStatus; sourceAssetId: string | null; contentHash: string | null; verifiedAt: string | null; items: BomItem[]; createdAt: string; updatedAt: string }
export interface BomImportRecord { id: string; schemeId: string; sourceHash: string; sourceFilename: string; sourceObjectKey: string | null; sourceByteSize: number | null; baseRevision: number; mappingRevision: number; preview: ParsedBom; errors: ParsedBom['errors']; warnings: ParsedBom['warnings']; canCommit: boolean; status: ImportStatus; committedRevision: number | null; commitRequestHash: string | null; committedResult: CommitResult | null; expiresAt: string }
export interface BomItemInput { id?: string; productName: string; productModel?: string | null; specificationMm?: string | null; sourceQuantity: string; sourceUnit: string; measurementKind: MeasurementKind; erpCode?: string | null; unitPrice?: string | null; totalPrice?: string | null; totalWeightKg?: string | null; sourceSheet?: string | null; sourceRow?: number | null; diffNote?: string | null }
export interface BomVerificationInput { requestKey: string; expectedRevision: number; decision: 'pass' | 'reject'; notes?: string }
export interface CommitResult { schemeCode: string; revision: number; status: BomStatus; itemCount: number; unpublished: boolean }
type DbClient = pg.Pool | pg.PoolClient;
interface SchemeRow { id: string; publishStatus: string }
interface BomRow extends Omit<BomRecord, 'items' | 'createdAt' | 'updatedAt' | 'verifiedAt'> { createdAt: Date | string; updatedAt: Date | string; verifiedAt: Date | string | null; items: BomItem[] }
interface ImportRow extends Omit<BomImportRecord, 'expiresAt'> { expiresAt: Date | string }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = (value: Date | string | null) => value === null ? null : value instanceof Date ? value.toISOString() : value;
export function bomError(reason: string, statusCode: number): Error & { statusCode: number; reason: string } { return Object.assign(new Error(reason), { statusCode, reason }); }

const snapshotSql = `SELECT b.id::text AS id, b.scheme_id::text AS "schemeId", b.revision, b.status, b.source_asset_id::text AS "sourceAssetId", b.content_hash AS "contentHash", b.verified_at AS "verifiedAt", b.created_at AS "createdAt", b.updated_at AS "updatedAt",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id::text, 'bomId', i.bom_id::text, 'ordinal', i.ordinal, 'productName', i.product_name, 'productModel', i.product_model, 'specificationMm', i.specification_mm, 'sourceQuantity', i.source_quantity::text, 'sourceUnit', i.source_unit, 'measurementKind', i.measurement_kind, 'quantity', i.quantity::text, 'erpCode', i.erp_code, 'unitPrice', i.unit_price::text, 'totalPrice', i.total_price::text, 'totalWeightKg', i.total_weight_kg::text, 'sourceSheet', i.source_sheet, 'sourceRow', i.source_row, 'diffNote', i.diff_note) ORDER BY i.ordinal) FROM scheme_bom_items i WHERE i.bom_id = b.id), '[]'::jsonb) AS items FROM scheme_boms b`;
function record(row: BomRow): BomRecord { return { ...row, verifiedAt: iso(row.verifiedAt), createdAt: iso(row.createdAt) ?? '', updatedAt: iso(row.updatedAt) ?? '' }; }
async function findBom(client: DbClient, schemeId: string): Promise<BomRecord | null> { const row = (await client.query<BomRow>(`${snapshotSql} WHERE b.scheme_id = $1`, [schemeId])).rows[0]; return row ? record(row) : null; }
async function schemeByCode(client: DbClient, code: string, lock = false): Promise<SchemeRow> {
  const row = (await client.query<SchemeRow>(`SELECT id::text AS id, publish_status AS "publishStatus" FROM schemes WHERE code = $1 ${lock ? 'FOR UPDATE' : ''}`, [code])).rows[0];
  if (!row) throw bomError('RESOURCE_NOT_FOUND', 404);
  return row;
}
async function lockedBom(client: pg.PoolClient, schemeId: string, expected: number): Promise<BomRecord> {
  const row = (await client.query<{ revision: number }>('SELECT revision FROM scheme_boms WHERE scheme_id = $1 FOR UPDATE', [schemeId])).rows[0];
  if (!row) throw bomError('BOM_NOT_AVAILABLE', 404);
  if (row.revision !== expected) throw bomError('BOM_REVISION_CHANGED', 409);
  const bom = await findBom(client, schemeId);
  if (!bom) throw bomError('BOM_NOT_AVAILABLE', 404);
  return bom;
}
function assertBomEditable(bom: BomRecord | null): void {
  if (bom?.status === 'verified') throw bomError('BOM_ALREADY_VERIFIED', 409);
}
async function unpublish(client: pg.PoolClient, scheme: SchemeRow, adminId: string): Promise<boolean> {
  const result = await client.query("UPDATE schemes SET publish_status = 'draft', updated_by = $1, updated_at = now(), revision = revision + 1 WHERE id = $2 AND publish_status = 'published'", [adminId, scheme.id]);
  return (result.rowCount ?? 0) > 0;
}
async function audit(client: pg.PoolClient, bomId: string, before: number, action: string, reason: string, adminId: string, summary: object): Promise<void> {
  await client.query('INSERT INTO bom_change_logs (bom_id, before_revision, after_revision, action, change_reason, admin_id, summary) VALUES ($1,$2,$3,$4,$5,$6,$7)', [bomId, before, before + 1, action, reason, adminId, JSON.stringify(summary)]);
}
function validateReason(reason: string): void { if (!reason.trim() || reason.length > 1000) throw bomError('INVALID_INPUT', 400); }
export function canonicalDecimal(value: string): string {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value)) throw bomError('INVALID_QUANTITY', 400);
  const [whole, fraction = ''] = value.split('.');
  return fraction.replace(/0+$/, '') ? `${whole}.${fraction.replace(/0+$/, '')}` : whole!;
}
export function quantityFor(value: string, kind: MeasurementKind, sourceUnit = kind === 'count' ? '件' : kind === 'length' ? 'mm' : 'mm²'): string {
  const normalized = canonicalDecimal(value);
  if (normalized === '0') throw bomError('INVALID_QUANTITY', 400);
  const [whole = '0', fraction = ''] = normalized.split('.');
  const scaled = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (!(kind === 'count' && ['个','件'].includes(sourceUnit) || kind === 'length' && ['mm','m'].includes(sourceUnit) || kind === 'area' && ['mm2','mm²','m2','m²'].includes(sourceUnit))) throw bomError('INVALID_INPUT', 400);
  const divisor = sourceUnit === 'mm' ? 1000n : ['mm2','mm²'].includes(sourceUnit) ? 1000000n : 1n;
  if (scaled % divisor !== 0n) throw bomError('INVALID_QUANTITY', 400);
  const result = scaled / divisor;
  if (result <= 0n || result >= 1000000000000000000n) throw bomError('INVALID_QUANTITY', 400);
  return canonicalDecimal(`${result / 1000000n}.${String(result % 1000000n).padStart(6, '0')}`);
}
function validateItems(items: BomItemInput[]): void {
  if (!items.length || items.length > 10000) throw bomError('INVALID_INPUT', 400);
  for (const item of items) {
    if (!['count','length','area'].includes(item.measurementKind) || !item.productName.trim() || !item.sourceUnit.trim()) throw bomError('INVALID_INPUT', 400);
    const normalized = canonicalDecimal(item.sourceQuantity);
    if (item.measurementKind === 'count' && normalized.includes('.')) throw bomError('INVALID_QUANTITY', 400);
    quantityFor(item.sourceQuantity, item.measurementKind, item.sourceUnit);
    for (const value of [item.unitPrice, item.totalPrice, item.totalWeightKg]) {
      if (value != null) canonicalDecimal(value);
    }
  }
}
function hashes(items: BomItem[]): { contentHash: string } {
  const normalizedItems = [...items].sort((a,b) => a.ordinal - b.ordinal).map(i => [i.ordinal,i.productName,i.productModel,i.specificationMm,canonicalDecimal(i.sourceQuantity),i.sourceUnit,i.measurementKind,canonicalDecimal(i.quantity),i.erpCode,i.unitPrice,i.totalPrice,i.totalWeightKg,i.sourceSheet,i.sourceRow,i.diffNote]);
  return { contentHash: digest(normalizedItems) };
}
async function persistHashes(client: pg.PoolClient, schemeId: string): Promise<void> {
  const bom = await findBom(client, schemeId); if (!bom) throw bomError('BOM_NOT_AVAILABLE', 404);
  const { contentHash } = hashes(bom.items);
  await client.query('UPDATE scheme_boms SET content_hash = $1 WHERE id = $2', [contentHash, bom.id]);
}
async function saveItems(client: pg.PoolClient, bom: Pick<BomRecord, 'id' | 'items'>, items: BomItemInput[]): Promise<void> {
  validateItems(items);
  const originalIds = new Set(bom.items.map(item => item.id)); const submittedIds = new Set<string>();
  for (const item of items) { if (item.id && (!originalIds.has(item.id) || submittedIds.has(item.id))) throw bomError('INVALID_INPUT', 400); if (item.id) submittedIds.add(item.id); }
  await client.query('DELETE FROM scheme_bom_items WHERE bom_id=$1', [bom.id]);
  for (const [index,item] of items.entries()) {
    const args = [item.id ?? randomUUID(),bom.id,index+1,item.productName,item.productModel ?? null,item.specificationMm ?? null,canonicalDecimal(item.sourceQuantity),item.sourceUnit,quantityFor(item.sourceQuantity,item.measurementKind,item.sourceUnit),item.measurementKind,item.erpCode ?? null,item.sourceSheet ?? null,item.sourceRow ?? null,item.diffNote ?? null,item.unitPrice == null ? null : canonicalDecimal(item.unitPrice),item.totalPrice == null ? null : canonicalDecimal(item.totalPrice),item.totalWeightKg == null ? null : canonicalDecimal(item.totalWeightKg)];
    await client.query(`INSERT INTO scheme_bom_items (id,bom_id,ordinal,product_name,product_model,specification_mm,source_quantity,source_unit,quantity,measurement_kind,erp_code,source_sheet,source_row,diff_note,unit_price,total_price,total_weight_kg) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,args);
  }
}
export async function getBom(pool: pg.Pool, schemeCode: string): Promise<BomRecord | null> { const scheme = await schemeByCode(pool,schemeCode); return findBom(pool,scheme.id); }
export async function listBoms(pool: pg.Pool, options: { code?: string; page: number; pageSize: number }): Promise<{ data: Array<{ schemeCode: string; schemeName: string; revision: number; status: BomStatus; itemCount: number; updatedAt: string }>; total: number }> {
  const filter = options.code ? 'WHERE s.code ILIKE $1' : '';
  const args = options.code ? [`%${options.code}%`] : [];
  const total = Number((await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM scheme_boms b JOIN schemes s ON s.id=b.scheme_id ${filter}`,args)).rows[0]?.count ?? 0);
  const rows = await pool.query<{ schemeCode: string; schemeName: string; revision: number; status: BomStatus; itemCount: number; updatedAt: Date | string }>(`SELECT s.code AS "schemeCode",s.name AS "schemeName",b.revision,b.status,(SELECT count(*)::integer FROM scheme_bom_items i WHERE i.bom_id=b.id) AS "itemCount",b.updated_at AS "updatedAt" FROM scheme_boms b JOIN schemes s ON s.id=b.scheme_id ${filter} ORDER BY b.updated_at DESC,b.id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,options.pageSize,(options.page-1)*options.pageSize]);
  return { data: rows.rows.map(row => ({...row,updatedAt:iso(row.updatedAt)!})),total };
}
export async function assertImportBaseline(pool: pg.Pool, schemeCode: string, expected: number): Promise<void> {
  const scheme = await schemeByCode(pool,schemeCode); const bom = await findBom(pool,scheme.id);
  if ((bom?.revision ?? 0) !== expected) throw bomError('BOM_REVISION_CHANGED',409);
  assertBomEditable(bom);
}
const importColumns = `i.id::text AS id,i.scheme_id::text AS "schemeId",i.source_hash AS "sourceHash",i.source_filename AS "sourceFilename",i.source_object_key AS "sourceObjectKey",i.source_byte_size AS "sourceByteSize",i.base_revision AS "baseRevision",i.mapping_revision AS "mappingRevision",i.preview,i.errors,i.warnings,i.can_commit AS "canCommit",i.status,i.committed_revision AS "committedRevision",i.commit_request_hash AS "commitRequestHash",i.committed_result AS "committedResult",i.expires_at AS "expiresAt"`;
const importReturning = importColumns.replaceAll('i.','');
function importRecord(row: ImportRow): BomImportRecord { return { ...row, expiresAt: iso(row.expiresAt) ?? '', status: row.status === 'ready' && new Date(row.expiresAt).getTime() <= Date.now() ? 'expired' : row.status }; }
export async function createBomImport(pool: pg.Pool, adminId: string, schemeCode: string, filename: string, sourceHash: string, objectKey: string, byteSize: number, baseRevision: number, preview: ParsedBom): Promise<BomImportRecord> {
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) throw bomError('INVALID_INPUT',400);
  return transaction(pool,async client => {
    const scheme = await schemeByCode(client,schemeCode,true); const bom = await findBom(client,scheme.id);
    if ((bom?.revision ?? 0) !== baseRevision) throw bomError('BOM_REVISION_CHANGED',409);
    assertBomEditable(bom);
    const canCommit = preview.errors.length === 0 && preview.items.length > 0;
    const row = (await client.query<ImportRow>(`INSERT INTO bom_imports (scheme_id,created_by,source_hash,source_filename,source_object_key,source_byte_size,base_revision,preview,errors,warnings,can_commit,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${importReturning}`, [scheme.id,adminId,sourceHash,filename,objectKey,byteSize,baseRevision,JSON.stringify(preview),JSON.stringify(preview.errors),JSON.stringify(preview.warnings),canCommit,canCommit?'ready':'invalid'])).rows[0];
    if (!row) throw bomError('INTERNAL_ERROR',500); return importRecord(row);
  });
}
export async function getBomImport(pool: pg.Pool, schemeCode: string, importId: string): Promise<BomImportRecord> {
  const row = (await pool.query<ImportRow>(`SELECT ${importColumns} FROM bom_imports i JOIN schemes s ON s.id=i.scheme_id WHERE s.code=$1 AND i.id=$2`,[schemeCode,importId])).rows[0];
  if (!row) throw bomError('RESOURCE_NOT_FOUND',404); return importRecord(row);
}
export async function createOrReplaceBomFromImport(pool: pg.Pool, adminId: string, schemeCode: string, importId: string, expected: number): Promise<CommitResult> {
  const requestHash = digest([expected]);
  const result = await transaction(pool,async client => {
    const scheme = await schemeByCode(client,schemeCode,true);
    const row = (await client.query<ImportRow>(`SELECT ${importColumns} FROM bom_imports i WHERE i.id=$1 AND i.scheme_id=$2 FOR UPDATE`,[importId,scheme.id])).rows[0];
    if (!row) throw bomError('RESOURCE_NOT_FOUND',404);
    if (row.status === 'committed') { if (row.commitRequestHash !== requestHash || !row.committedResult) throw bomError('IDEMPOTENCY_CONFLICT',409); return row.committedResult; }
    if (new Date(row.expiresAt).getTime() <= Date.now()) { await client.query("UPDATE bom_imports SET status='expired' WHERE id=$1",[importId]); return null; }
    if (row.status === 'expired') throw bomError('IMPORT_EXPIRED',410);
    if (!row.canCommit || row.status !== 'ready' || row.errors.length || row.mappingRevision !== 5) throw bomError('IMPORT_NOT_READY',409);
    if (expected !== row.baseRevision) throw bomError('BOM_REVISION_CHANGED',409);
    const old = await findBom(client,scheme.id);
    if ((old?.revision ?? 0) !== expected) throw bomError('BOM_REVISION_CHANGED',409);
    assertBomEditable(old);
    const bomId = old?.id ?? randomUUID();
    if (old) {
      await client.query('DELETE FROM scheme_bom_items WHERE bom_id=$1',[bomId]);
      await client.query("UPDATE scheme_boms SET revision=revision+1,status='pending_verification',source_asset_id=NULL,verified_at=NULL,updated_by=$2,updated_at=now() WHERE id=$1",[bomId,adminId]);
    } else await client.query('INSERT INTO scheme_boms (id,scheme_id,created_by,updated_by) VALUES ($1,$2,$3,$3)',[bomId,scheme.id,adminId]);
    if (!row.sourceObjectKey || row.sourceByteSize === null) throw bomError('IMPORT_NOT_READY',409);
    const source = await client.query<{ id:string }>("INSERT INTO scheme_assets (scheme_id,type,name,is_active,created_by,updated_by) VALUES ($1,'checklist',$2,true,$3,$3) RETURNING id::text AS id",[scheme.id,row.sourceFilename,adminId]);
    const sourceId = source.rows[0]?.id;
    if (!sourceId) throw bomError('INTERNAL_ERROR',500);
    await client.query('INSERT INTO asset_versions (asset_id,object_key,original_filename,mime_type,byte_size,checksum,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',[sourceId,row.sourceObjectKey,row.sourceFilename,row.sourceFilename.toLowerCase().endsWith('.xlsm')?'application/vnd.ms-excel.sheet.macroEnabled.12':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',row.sourceByteSize,row.sourceHash,adminId]);
    await client.query('UPDATE scheme_boms SET source_asset_id=$1 WHERE id=$2',[sourceId,bomId]);
    const empty = { id: bomId, items: [] };
    await saveItems(client,empty,row.preview.items);
    await persistHashes(client,scheme.id);
    const unpublished = await unpublish(client,scheme,adminId);
    const result: CommitResult = { schemeCode,revision: expected+1,status:'pending_verification',itemCount:row.preview.items.length,unpublished };
    await client.query("UPDATE bom_imports SET status='committed',committed_revision=$1,commit_request_hash=$2,committed_result=$3 WHERE id=$4",[result.revision,requestHash,JSON.stringify(result),importId]);
    await audit(client,bomId,expected,'import','导入方案清单',adminId,{ importId,itemCount:result.itemCount,sourceHash:row.sourceHash });
    return result;
  });
  if (!result) throw bomError('IMPORT_EXPIRED',410);
  return result;
}
export async function updateBomItems(pool: pg.Pool, adminId: string, code: string, expected: number, reason: string, items: BomItemInput[]): Promise<BomRecord> {
  validateReason(reason);
  return transaction(pool,async client => {
    const scheme = await schemeByCode(client,code,true); const bom = await lockedBom(client,scheme.id,expected);
    assertBomEditable(bom);
    return replaceItems(client,scheme,bom,adminId,reason,items);
  });
}
async function replaceItems(client: pg.PoolClient, scheme: SchemeRow, bom: BomRecord, adminId: string, reason: string, items: BomItemInput[]): Promise<BomRecord> {
  await saveItems(client,bom,items);
  await client.query("UPDATE scheme_boms SET revision=revision+1,status='pending_verification',verified_at=NULL,updated_by=$2,updated_at=now() WHERE id=$1",[bom.id,adminId]);
  await persistHashes(client,scheme.id); await unpublish(client,scheme,adminId);
  await audit(client,bom.id,bom.revision,'items',reason,adminId,{ itemCount:items.length });
  return (await findBom(client,scheme.id))!;
}
export async function deleteBomItem(pool: pg.Pool, adminId: string, code: string, itemId: string, expected: number): Promise<BomRecord> {
  return transaction(pool,async client => {
    const scheme = await schemeByCode(client,code,true); const bom = await lockedBom(client,scheme.id,expected);
    assertBomEditable(bom);
    const item = bom.items.find(entry => entry.id === itemId);
    if (!item) throw bomError('RESOURCE_NOT_FOUND',404);
    if (bom.items.length === 1) throw bomError('LAST_BOM_ITEM',409);
    return replaceItems(client,scheme,bom,adminId,`删除条目：${item.productName}`,bom.items.filter(entry => entry.id !== itemId));
  });
}
export async function deleteBom(pool: pg.Pool, adminId: string, code: string, expected: number): Promise<void> {
  await transaction(pool,async client => {
    const scheme = await schemeByCode(client,code,true);
    const bom = await lockedBom(client,scheme.id,expected);
    assertBomEditable(bom);
    await unpublish(client,scheme,adminId);
    await client.query('DELETE FROM scheme_boms WHERE id=$1',[bom.id]);
  });
}
export async function submitBomVerification(pool: pg.Pool, adminId: string, code: string, input: BomVerificationInput): Promise<{ verificationId: string; revision: number; status: BomStatus; verifiedAt: string | null; replayed: boolean }> {
  return transaction(pool,async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.requestKey]);
    const scheme = await schemeByCode(client,code,true);
    const notes = input.decision === 'reject' ? input.notes?.trim() : undefined;
    if (input.decision === 'reject' && !notes) throw bomError('VERIFICATION_INCOMPLETE',400);
    const requestHash = digest([scheme.id,input.expectedRevision,input.decision,notes ?? null]);
    const existing = (await client.query<{ id: string; bomId: string; requestHash: string; resultingRevision: number; decision: 'pass'|'reject'; verifiedAt: Date|string|null }>('SELECT id::text AS id,bom_id::text AS "bomId",request_hash AS "requestHash",resulting_revision AS "resultingRevision",decision,verified_at AS "verifiedAt" FROM bom_verifications WHERE request_key=$1 FOR UPDATE',[input.requestKey])).rows[0];
    if (existing) {
      const target = await findBom(client,scheme.id);
      if (target?.id !== existing.bomId || existing.requestHash !== requestHash) throw bomError('IDEMPOTENCY_CONFLICT',409);
      return { verificationId: existing.id,revision:existing.resultingRevision,status:existing.decision==='pass'?'verified' as const:'rejected' as const,verifiedAt:iso(existing.verifiedAt),replayed:true };
    }
    const bom = await lockedBom(client,scheme.id,input.expectedRevision);
    assertBomEditable(bom);
    const { contentHash } = hashes(bom.items);
    const status = input.decision === 'pass' ? 'verified' : 'rejected';
    const row = (await client.query<{ id: string; verifiedAt: Date|string|null }>(`INSERT INTO bom_verifications (bom_id,request_key,request_hash,content_revision,resulting_revision,content_hash,decision,notes,admin_id,verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $7='pass' THEN now() ELSE NULL END) RETURNING id::text AS id,verified_at AS "verifiedAt"`,[bom.id,input.requestKey,requestHash,bom.revision,bom.revision+1,contentHash,input.decision,notes ?? null,adminId])).rows[0];
    if (!row) throw bomError('INTERNAL_ERROR',500);
    await client.query('UPDATE scheme_boms SET revision=revision+1,status=$2,verified_at=$3,content_hash=$4,updated_by=$5,updated_at=now() WHERE id=$1',[bom.id,status,row.verifiedAt,contentHash,adminId]);
    if (status === 'rejected') await unpublish(client,scheme,adminId);
    await audit(client,bom.id,bom.revision,'verification',notes ?? '核验通过',adminId,{ decision: input.decision });
    return { verificationId:row.id,revision:bom.revision+1,status,verifiedAt:iso(row.verifiedAt),replayed:false };
  });
}
