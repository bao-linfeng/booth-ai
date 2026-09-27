import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from '../../../infra/database.js';
import type { ParsedBom } from './workbook.js';

export type BomStatus = 'pending_verification' | 'verified' | 'rejected';
export type MeasurementKind = 'count' | 'length' | 'area';
export type ConversionCode = 'identity' | 'mm_to_m' | 'mm2_to_m2';
export type ImportStatus = 'ready' | 'invalid' | 'committed' | 'expired';
export interface BomUnitRule { id: string; bomId: string; measurementKind: MeasurementKind; sourceUnit: string; pricingUnit: string; conversionCode: ConversionCode }
export interface BomItem { id: string; bomId: string; ordinal: number; productName: string; productModel: string | null; specificationMm: string | null; sourceQuantity: string; sourceUnit: string; quantity: string; unitRuleId: string | null; erpCode: string | null; sourceSheet: string | null; sourceRow: number | null; diffNote: string | null }
export interface BomRecord { id: string; schemeId: string; revision: number; status: BomStatus; sourceAssetId: string | null; contentHash: string | null; unitRulesHash: string | null; modelAssetId: string | null; modelAssetVersionId: string | null; modelHash: string | null; verifiedAt: string | null; items: BomItem[]; unitRules: BomUnitRule[]; createdAt: string; updatedAt: string }
export interface BomImportRecord { id: string; schemeId: string; sourceHash: string; sourceFilename: string; sourceObjectKey: string | null; sourceByteSize: number | null; baseRevision: number; mappingRevision: number; preview: ParsedBom; errors: ParsedBom['errors']; warnings: ParsedBom['warnings']; canCommit: boolean; status: ImportStatus; committedRevision: number | null; commitRequestHash: string | null; committedResult: CommitResult | null; expiresAt: string }
export interface BomItemInput { id?: string; productName: string; productModel?: string | null; specificationMm?: string | null; sourceQuantity: string; sourceUnit: string; unitRuleId?: string | null; erpCode?: string | null; sourceSheet?: string | null; sourceRow?: number | null; diffNote?: string | null }
export interface UnitRuleInput { id?: string; measurementKind: MeasurementKind; sourceUnit: string; pricingUnit: string; conversionCode: ConversionCode }
export interface BomVerificationInput { requestKey: string; expectedRevision: number; decision: 'pass' | 'reject'; checks: { sourceExtraction: boolean; modelCrossCheck: boolean; supportingParts: boolean; unitConsistency: boolean }; modelAssetId?: string | null; notes?: string | null }
export interface CommitResult { schemeCode: string; revision: number; status: BomStatus; itemCount: number; unpublished: boolean }
type DbClient = pg.Pool | pg.PoolClient;
interface SchemeRow { id: string; publishStatus: string }
interface BomRow extends Omit<BomRecord, 'items' | 'unitRules' | 'createdAt' | 'updatedAt' | 'verifiedAt'> { createdAt: Date | string; updatedAt: Date | string; verifiedAt: Date | string | null; items: BomItem[]; unitRules: BomUnitRule[] }
interface ImportRow extends Omit<BomImportRecord, 'expiresAt'> { expiresAt: Date | string }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = (value: Date | string | null) => value === null ? null : value instanceof Date ? value.toISOString() : value;
export function bomError(reason: string, statusCode: number): Error & { statusCode: number; reason: string } { return Object.assign(new Error(reason), { statusCode, reason }); }

const snapshotSql = `SELECT b.id::text AS id, b.scheme_id::text AS "schemeId", b.revision, b.status, b.source_asset_id::text AS "sourceAssetId", b.content_hash AS "contentHash", b.unit_rules_hash AS "unitRulesHash", b.model_asset_id::text AS "modelAssetId", b.model_asset_version_id::text AS "modelAssetVersionId", b.model_hash AS "modelHash", b.verified_at AS "verifiedAt", b.created_at AS "createdAt", b.updated_at AS "updatedAt",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id::text, 'bomId', i.bom_id::text, 'ordinal', i.ordinal, 'productName', i.product_name, 'productModel', i.product_model, 'specificationMm', i.specification_mm, 'sourceQuantity', i.source_quantity::text, 'sourceUnit', i.source_unit, 'quantity', i.quantity::text, 'unitRuleId', i.unit_rule_id::text, 'erpCode', i.erp_code, 'sourceSheet', i.source_sheet, 'sourceRow', i.source_row, 'diffNote', i.diff_note) ORDER BY i.ordinal) FROM scheme_bom_items i WHERE i.bom_id = b.id), '[]'::jsonb) AS items,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id::text, 'bomId', r.bom_id::text, 'measurementKind', r.measurement_kind, 'sourceUnit', r.source_unit, 'pricingUnit', r.pricing_unit, 'conversionCode', r.conversion_code) ORDER BY r.created_at, r.id) FROM scheme_bom_unit_rules r WHERE r.bom_id = b.id), '[]'::jsonb) AS "unitRules" FROM scheme_boms b`;
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
export function quantityFor(value: string, rule: UnitRuleInput | BomUnitRule): string {
  const normalized = canonicalDecimal(value);
  if (normalized === '0') throw bomError('INVALID_QUANTITY', 400);
  const [whole = '0', fraction = ''] = normalized.split('.');
  const scaled = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  const divisor = rule.conversionCode === 'mm_to_m' ? 1000n : rule.conversionCode === 'mm2_to_m2' ? 1000000n : 1n;
  if (scaled % divisor !== 0n) throw bomError('INVALID_QUANTITY', 400);
  const result = scaled / divisor;
  if (result <= 0n || result >= 1000000000000000000n) throw bomError('INVALID_QUANTITY', 400);
  return canonicalDecimal(`${result / 1000000n}.${String(result % 1000000n).padStart(6, '0')}`);
}
function validateRules(rules: UnitRuleInput[]): void {
  if (!rules.length || rules.length > 1000) throw bomError('UNIT_RULE_INVALID', 400);
  const sources = new Set<string>(); const ids = new Set<string>();
  for (const rule of rules) {
    if (!rule.sourceUnit.trim() || !rule.pricingUnit.trim() || sources.has(rule.sourceUnit) || (rule.id && ids.has(rule.id))) throw bomError('UNIT_RULE_INVALID', 400);
    sources.add(rule.sourceUnit); if (rule.id) ids.add(rule.id);
    if (!(rule.conversionCode === 'identity' && rule.sourceUnit === rule.pricingUnit || rule.measurementKind === 'length' && rule.conversionCode === 'mm_to_m' && rule.sourceUnit === 'mm' && rule.pricingUnit === 'm' || rule.measurementKind === 'area' && rule.conversionCode === 'mm2_to_m2' && ['mm2','mm²'].includes(rule.sourceUnit) && ['m2','m²'].includes(rule.pricingUnit))) throw bomError('UNIT_RULE_INVALID', 400);
    if (rule.measurementKind === 'count' && !['个', '件'].includes(rule.sourceUnit)) throw bomError('UNIT_RULE_INVALID', 400);
    if ((rule.measurementKind === 'length' && !['mm','m'].includes(rule.sourceUnit)) || (rule.measurementKind === 'area' && !['mm2','mm²','m2','m²'].includes(rule.sourceUnit))) throw bomError('UNIT_RULE_INVALID',400);
  }
}
function validateItems(items: BomItemInput[], rules: BomUnitRule[]): void {
  if (!items.length || items.length > 10000) throw bomError('INVALID_INPUT', 400);
  for (const item of items) {
    const rule = rules.find(r => r.id === item.unitRuleId);
    if (!rule || rule.sourceUnit !== item.sourceUnit || !item.productName.trim()) throw bomError('UNIT_RULE_INVALID', 400);
    const normalized = canonicalDecimal(item.sourceQuantity);
    if (rule.measurementKind === 'count' && normalized.includes('.')) throw bomError('INVALID_QUANTITY', 400);
    quantityFor(item.sourceQuantity, rule);
  }
}
function hashes(items: BomItem[], rules: BomUnitRule[]): { contentHash: string; unitRulesHash: string } {
  const normalizedRules = [...rules].sort((a,b) => a.sourceUnit.localeCompare(b.sourceUnit)).map(r => [r.measurementKind,r.sourceUnit,r.pricingUnit,r.conversionCode]);
  const normalizedItems = [...items].sort((a,b) => a.ordinal - b.ordinal).map(i => [i.ordinal,i.productName,i.productModel,i.specificationMm,canonicalDecimal(i.sourceQuantity),i.sourceUnit,canonicalDecimal(i.quantity),rules.find(r => r.id === i.unitRuleId)?.sourceUnit ?? null,i.erpCode,i.sourceSheet,i.sourceRow,i.diffNote]);
  return { contentHash: digest([normalizedItems, normalizedRules]), unitRulesHash: digest(normalizedRules) };
}
async function persistHashes(client: pg.PoolClient, schemeId: string): Promise<void> {
  const bom = await findBom(client, schemeId); if (!bom) throw bomError('BOM_NOT_AVAILABLE', 404);
  const { contentHash, unitRulesHash } = hashes(bom.items, bom.unitRules);
  await client.query('UPDATE scheme_boms SET content_hash = $1, unit_rules_hash = $2 WHERE id = $3', [contentHash, unitRulesHash, bom.id]);
}
async function saveRules(client: pg.PoolClient, bomId: string, inputs: UnitRuleInput[]): Promise<BomUnitRule[]> {
  validateRules(inputs);
  for (const rule of inputs) {
    await client.query('INSERT INTO scheme_bom_unit_rules (id,bom_id,measurement_kind,source_unit,pricing_unit,conversion_code) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET measurement_kind=$3,source_unit=$4,pricing_unit=$5,conversion_code=$6 WHERE scheme_bom_unit_rules.bom_id=$2', [rule.id ?? randomUUID(),bomId,rule.measurementKind,rule.sourceUnit,rule.pricingUnit,rule.conversionCode]);
  }
  return (await client.query<BomUnitRule>('SELECT id::text AS id,bom_id::text AS "bomId",measurement_kind AS "measurementKind",source_unit AS "sourceUnit",pricing_unit AS "pricingUnit",conversion_code AS "conversionCode" FROM scheme_bom_unit_rules WHERE bom_id=$1 ORDER BY created_at,id', [bomId])).rows;
}
async function saveItems(client: pg.PoolClient, bom: BomRecord, items: BomItemInput[], rules: BomUnitRule[]): Promise<void> {
  validateItems(items,rules);
  const originalIds = new Set(bom.items.map(item => item.id)); const submittedIds = new Set<string>();
  for (const item of items) { if (item.id && (!originalIds.has(item.id) || submittedIds.has(item.id))) throw bomError('INVALID_INPUT', 400); if (item.id) submittedIds.add(item.id); }
  await client.query('DELETE FROM scheme_bom_items WHERE bom_id=$1', [bom.id]);
  for (const [index,item] of items.entries()) {
    const rule = rules.find(r => r.id === item.unitRuleId)!;
    const args = [item.id ?? randomUUID(),bom.id,index+1,item.productName,item.productModel ?? null,item.specificationMm ?? null,canonicalDecimal(item.sourceQuantity),item.sourceUnit,quantityFor(item.sourceQuantity,rule),rule.id,item.erpCode ?? null,item.sourceSheet ?? null,item.sourceRow ?? null,item.diffNote ?? null];
    await client.query(`INSERT INTO scheme_bom_items (id,bom_id,ordinal,product_name,product_model,specification_mm,source_quantity,source_unit,quantity,unit_rule_id,erp_code,source_sheet,source_row,diff_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,args);
  }
}
export async function getBom(pool: pg.Pool, schemeCode: string): Promise<BomRecord | null> { const scheme = await schemeByCode(pool,schemeCode); return findBom(pool,scheme.id); }
export async function assertImportBaseline(pool: pg.Pool, schemeCode: string, expected: number): Promise<void> {
  const scheme = await schemeByCode(pool,schemeCode); const bom = await findBom(pool,scheme.id);
  if ((bom?.revision ?? 0) !== expected) throw bomError('BOM_REVISION_CHANGED',409);
}
const importColumns = `i.id::text AS id,i.scheme_id::text AS "schemeId",i.source_hash AS "sourceHash",i.source_filename AS "sourceFilename",i.source_object_key AS "sourceObjectKey",i.source_byte_size AS "sourceByteSize",i.base_revision AS "baseRevision",i.mapping_revision AS "mappingRevision",i.preview,i.errors,i.warnings,i.can_commit AS "canCommit",i.status,i.committed_revision AS "committedRevision",i.commit_request_hash AS "commitRequestHash",i.committed_result AS "committedResult",i.expires_at AS "expiresAt"`;
const importReturning = importColumns.replaceAll('i.','');
function importRecord(row: ImportRow): BomImportRecord { return { ...row, expiresAt: iso(row.expiresAt) ?? '', status: row.status === 'ready' && new Date(row.expiresAt).getTime() <= Date.now() ? 'expired' : row.status }; }
export async function createBomImport(pool: pg.Pool, adminId: string, schemeCode: string, filename: string, sourceHash: string, objectKey: string, byteSize: number, baseRevision: number, preview: ParsedBom): Promise<BomImportRecord> {
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) throw bomError('INVALID_INPUT',400);
  return transaction(pool,async client => {
    const scheme = await schemeByCode(client,schemeCode,true); const bom = await findBom(client,scheme.id);
    if ((bom?.revision ?? 0) !== baseRevision) throw bomError('BOM_REVISION_CHANGED',409);
    const canCommit = preview.errors.length === 0 && preview.items.length > 0;
    const row = (await client.query<ImportRow>(`INSERT INTO bom_imports (scheme_id,created_by,source_hash,source_filename,source_object_key,source_byte_size,base_revision,preview,errors,warnings,can_commit,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${importReturning}`, [scheme.id,adminId,sourceHash,filename,objectKey,byteSize,baseRevision,JSON.stringify(preview),JSON.stringify(preview.errors),JSON.stringify(preview.warnings),canCommit,canCommit?'ready':'invalid'])).rows[0];
    if (!row) throw bomError('INTERNAL_ERROR',500); return importRecord(row);
  });
}
export async function getBomImport(pool: pg.Pool, schemeCode: string, importId: string): Promise<BomImportRecord> {
  const row = (await pool.query<ImportRow>(`SELECT ${importColumns} FROM bom_imports i JOIN schemes s ON s.id=i.scheme_id WHERE s.code=$1 AND i.id=$2`,[schemeCode,importId])).rows[0];
  if (!row) throw bomError('RESOURCE_NOT_FOUND',404); return importRecord(row);
}
export async function createOrReplaceBomFromImport(pool: pg.Pool, adminId: string, schemeCode: string, importId: string, expected: number, confirmed: string[], reason: string): Promise<CommitResult> {
  validateReason(reason);
  const requestHash = digest([expected,[...confirmed].sort(),reason]);
  const result = await transaction(pool,async client => {
    const scheme = await schemeByCode(client,schemeCode,true);
    const row = (await client.query<ImportRow>(`SELECT ${importColumns} FROM bom_imports i WHERE i.id=$1 AND i.scheme_id=$2 FOR UPDATE`,[importId,scheme.id])).rows[0];
    if (!row) throw bomError('RESOURCE_NOT_FOUND',404);
    if (row.status === 'committed') { if (row.commitRequestHash !== requestHash || !row.committedResult) throw bomError('IDEMPOTENCY_CONFLICT',409); return row.committedResult; }
    if (new Date(row.expiresAt).getTime() <= Date.now()) { await client.query("UPDATE bom_imports SET status='expired' WHERE id=$1",[importId]); return null; }
    if (row.status === 'expired') throw bomError('IMPORT_EXPIRED',410);
    if (!row.canCommit || row.status !== 'ready' || row.errors.length) throw bomError('IMPORT_NOT_READY',409);
    if (expected !== row.baseRevision) throw bomError('BOM_REVISION_CHANGED',409);
    if (confirmed.length !== new Set(confirmed).size || [...new Set(row.warnings.map(w => w.code))].sort().join('|') !== [...confirmed].sort().join('|')) throw bomError('WARNINGS_UNCONFIRMED',400);
    const old = await findBom(client,scheme.id);
    if ((old?.revision ?? 0) !== expected) throw bomError('BOM_REVISION_CHANGED',409);
    const bomId = old?.id ?? randomUUID();
    if (old) {
      await client.query('DELETE FROM scheme_bom_items WHERE bom_id=$1',[bomId]);
      await client.query('DELETE FROM scheme_bom_unit_rules WHERE bom_id=$1',[bomId]);
      await client.query("UPDATE scheme_boms SET revision=revision+1,status='pending_verification',source_asset_id=NULL,model_asset_id=NULL,model_asset_version_id=NULL,model_hash=NULL,verified_at=NULL,updated_by=$2,updated_at=now() WHERE id=$1",[bomId,adminId]);
    } else await client.query('INSERT INTO scheme_boms (id,scheme_id,created_by,updated_by) VALUES ($1,$2,$3,$3)',[bomId,scheme.id,adminId]);
    if (!row.sourceObjectKey || row.sourceByteSize === null) throw bomError('IMPORT_NOT_READY',409);
    const source = await client.query<{ id:string }>("INSERT INTO scheme_assets (scheme_id,type,name,is_active,created_by,updated_by) VALUES ($1,'checklist',$2,false,$3,$3) RETURNING id::text AS id",[scheme.id,row.sourceFilename,adminId]);
    const sourceId = source.rows[0]?.id;
    if (!sourceId) throw bomError('INTERNAL_ERROR',500);
    await client.query('INSERT INTO asset_versions (asset_id,object_key,original_filename,mime_type,byte_size,checksum,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',[sourceId,row.sourceObjectKey,row.sourceFilename,row.sourceFilename.toLowerCase().endsWith('.xlsm')?'application/vnd.ms-excel.sheet.macroEnabled.12':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',row.sourceByteSize,row.sourceHash,adminId]);
    await client.query('UPDATE scheme_boms SET source_asset_id=$1 WHERE id=$2',[sourceId,bomId]);
    const rules = await saveRules(client,bomId,row.preview.unitRules);
    const empty = { id: bomId, items: [] } as unknown as BomRecord;
    await saveItems(client,empty,row.preview.items.map(item => ({ ...item,unitRuleId: rules.find(rule => rule.sourceUnit === item.sourceUnit)?.id })),rules);
    await persistHashes(client,scheme.id);
    const unpublished = await unpublish(client,scheme,adminId);
    const result: CommitResult = { schemeCode,revision: expected+1,status:'pending_verification',itemCount:row.preview.items.length,unpublished };
    await client.query("UPDATE bom_imports SET status='committed',committed_revision=$1,commit_request_hash=$2,committed_result=$3 WHERE id=$4",[result.revision,requestHash,JSON.stringify(result),importId]);
    await audit(client,bomId,expected,'import',reason,adminId,{ importId,itemCount:result.itemCount,sourceHash:row.sourceHash });
    return result;
  });
  if (!result) throw bomError('IMPORT_EXPIRED',410);
  return result;
}
export async function updateBomItems(pool: pg.Pool, adminId: string, code: string, expected: number, reason: string, items: BomItemInput[]): Promise<BomRecord> {
  validateReason(reason);
  return transaction(pool,async client => {
    const scheme = await schemeByCode(client,code,true); const bom = await lockedBom(client,scheme.id,expected);
    await saveItems(client,bom,items,bom.unitRules);
    await client.query("UPDATE scheme_boms SET revision=revision+1,status='pending_verification',verified_at=NULL,model_asset_id=NULL,model_asset_version_id=NULL,model_hash=NULL,updated_by=$2,updated_at=now() WHERE id=$1",[bom.id,adminId]);
    await persistHashes(client,scheme.id); await unpublish(client,scheme,adminId);
    await audit(client,bom.id,expected,'items',reason,adminId,{ itemCount:items.length });
    return (await findBom(client,scheme.id))!;
  });
}
export async function updateBomUnitRules(pool: pg.Pool, adminId: string, code: string, expected: number, reason: string, rules: UnitRuleInput[]): Promise<BomRecord> {
  validateReason(reason); validateRules(rules);
  return transaction(pool,async client => {
    const scheme = await schemeByCode(client,code,true); const bom = await lockedBom(client,scheme.id,expected);
    const oldIds = new Set(bom.unitRules.map(rule => rule.id)); const incoming = new Set(rules.map(rule => rule.id));
    if (rules.some(rule => rule.id && !oldIds.has(rule.id)) || bom.items.some(item => item.unitRuleId && !incoming.has(item.unitRuleId))) throw bomError('UNIT_RULE_INVALID',409);
    const removed = bom.unitRules.filter(rule => !incoming.has(rule.id));
    if (removed.length) await client.query('DELETE FROM scheme_bom_unit_rules WHERE bom_id=$1 AND id=ANY($2::uuid[])',[bom.id,removed.map(rule=>rule.id)]);
    for (const rule of rules) {
      const current = bom.unitRules.find(old => old.id === rule.id);
      if (current && current.sourceUnit !== rule.sourceUnit) throw bomError('UNIT_RULE_INVALID',409);
    }
    const updatedRules = await saveRules(client,bom.id,rules);
    for (const item of bom.items) {
      const rule = updatedRules.find(candidate => candidate.id === item.unitRuleId);
      if (!rule || rule.sourceUnit !== item.sourceUnit) throw bomError('UNIT_RULE_INVALID',409);
      await client.query('UPDATE scheme_bom_items SET quantity=$1 WHERE id=$2',[quantityFor(item.sourceQuantity,rule),item.id]);
    }
    await client.query("UPDATE scheme_boms SET revision=revision+1,status='pending_verification',verified_at=NULL,model_asset_id=NULL,model_asset_version_id=NULL,model_hash=NULL,updated_by=$2,updated_at=now() WHERE id=$1",[bom.id,adminId]);
    await persistHashes(client,scheme.id); await unpublish(client,scheme,adminId);
    await audit(client,bom.id,expected,'unit_rules',reason,adminId,{ ruleCount:rules.length });
    return (await findBom(client,scheme.id))!;
  });
}
export async function submitBomVerification(pool: pg.Pool, adminId: string, code: string, input: BomVerificationInput): Promise<{ verificationId: string; revision: number; status: BomStatus; verifiedAt: string | null; replayed: boolean }> {
  return transaction(pool,async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.requestKey]);
    const scheme = await schemeByCode(client,code,true);
    const requestHash = digest([scheme.id,input.expectedRevision,input.decision,[input.checks.sourceExtraction,input.checks.modelCrossCheck,input.checks.supportingParts,input.checks.unitConsistency],input.modelAssetId ?? null,input.notes ?? null]);
    const existing = (await client.query<{ id: string; bomId: string; requestHash: string; resultingRevision: number; decision: 'pass'|'reject'; verifiedAt: Date|string|null }>('SELECT id::text AS id,bom_id::text AS "bomId",request_hash AS "requestHash",resulting_revision AS "resultingRevision",decision,verified_at AS "verifiedAt" FROM bom_verifications WHERE request_key=$1 FOR UPDATE',[input.requestKey])).rows[0];
    if (existing) {
      const target = await findBom(client,scheme.id);
      if (target?.id !== existing.bomId || existing.requestHash !== requestHash) throw bomError('IDEMPOTENCY_CONFLICT',409);
      return { verificationId: existing.id,revision:existing.resultingRevision,status:existing.decision==='pass'?'verified' as const:'rejected' as const,verifiedAt:iso(existing.verifiedAt),replayed:true };
    }
    const bom = await lockedBom(client,scheme.id,input.expectedRevision);
    if (input.decision === 'pass' && (!Object.values(input.checks).every(Boolean) || !input.modelAssetId)) throw bomError('VERIFICATION_INCOMPLETE',400);
    if (input.decision === 'reject' && !input.notes?.trim()) throw bomError('VERIFICATION_INCOMPLETE',400);
    const model = input.modelAssetId ? (await client.query<{ id: string; checksum: string }>(`SELECT av.id::text AS id,av.checksum FROM scheme_assets a JOIN LATERAL (SELECT id,checksum FROM asset_versions WHERE asset_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1) av ON true WHERE a.id=$1 AND a.scheme_id=$2 AND a.type='model' AND a.is_active=true FOR UPDATE OF a`,[input.modelAssetId,scheme.id])).rows[0] : undefined;
    if (input.modelAssetId && !model) throw bomError('MODEL_INVALID',400);
    const { contentHash } = hashes(bom.items,bom.unitRules);
    const status = input.decision === 'pass' ? 'verified' : 'rejected';
    const row = (await client.query<{ id: string; verifiedAt: Date|string|null }>(`INSERT INTO bom_verifications (bom_id,request_key,request_hash,content_revision,resulting_revision,content_hash,model_hash,model_asset_id,model_asset_version_id,checks,decision,notes,admin_id,verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $11='pass' THEN now() ELSE NULL END) RETURNING id::text AS id,verified_at AS "verifiedAt"`,[bom.id,input.requestKey,requestHash,bom.revision,bom.revision+1,contentHash,model?.checksum ?? null,input.modelAssetId ?? null,model?.id ?? null,JSON.stringify(input.checks),input.decision,input.notes ?? null,adminId])).rows[0];
    if (!row) throw bomError('INTERNAL_ERROR',500);
    await client.query('UPDATE scheme_boms SET revision=revision+1,status=$2,verified_at=$3,content_hash=$4,model_asset_id=$5,model_asset_version_id=$6,model_hash=$7,updated_by=$8,updated_at=now() WHERE id=$1',[bom.id,status,row.verifiedAt,contentHash,input.modelAssetId ?? null,model?.id ?? null,model?.checksum ?? null,adminId]);
    if (status === 'rejected') await unpublish(client,scheme,adminId);
    await audit(client,bom.id,bom.revision,'verification',input.notes?.trim() || '核验通过',adminId,{ decision: input.decision,modelAssetVersionId:model?.id ?? null });
    return { verificationId:row.id,revision:bom.revision+1,status,verifiedAt:iso(row.verifiedAt),replayed:false };
  });
}
