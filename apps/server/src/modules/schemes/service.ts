import { isDeepStrictEqual } from 'node:util';
import type pg from 'pg';
import { transaction } from '../../infra/database.js';
import { ensureSelectionSizes } from '../dictionaries/sizes.js';
import { writeAuditLog } from '../../infra/audit.js';
import { validateSchemeDictionaryIds } from './dictionary-ids.js';

export interface SchemeInput {
  code?: string;
  name?: string;
  parentCode?: string | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  areaM2?: number | null;
  openingCount?: number | null;
  productSystemId?: string | null;
  styleId?: string | null;
  industryIds?: string[] | null;
  budgetTierId?: string | null;
  zoneIds?: string[] | null;
  featureIds?: string[] | null;
  description?: string | null;
  keywords?: string[] | null;
  source?: string | null;
  visualTheme?: string | null;
  notes?: string | null;
}

export interface ListSchemesOptions {
  page: number;
  pageSize: number;
  /** 编号或名称包含该关键词 */
  keyword?: string;
  code?: string;
  name?: string;
  styleId?: string;
  industryId?: string;
  productSystemId?: string;
  publishStatus?: string;
  verificationStatus?: string;
  openingCount?: number;
  budgetTierId?: string;
  zoneIds?: string[];
  featureIds?: string[];
  parentCode?: string;
  sortBy?: 'updatedAt' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface SchemeRecord {
  id: string;
  code: string;
  name: string;
  parentCode: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  areaM2: string | null;
  openingCount: number | null;
  productSystemId: string | null;
  styleId: string | null;
  industryIds: string[];
  budgetTierId: string | null;
  zoneIds: string[];
  featureIds: string[];
  description: string | null;
  keywords: string[] | null;
  source: string | null;
  visualTheme: string | null;
  publishStatus: string;
  verificationStatus: string;
  notes: string | null;
  editRevision: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SchemeRow extends Omit<SchemeRecord, 'createdAt' | 'updatedAt'> {
  createdAt: Date | string;
  updatedAt: Date | string;
}

const schemeColumns = `
  id, code, name, parent_code AS "parentCode", length_mm AS "lengthMm",
  width_mm AS "widthMm", height_mm AS "heightMm", area_sqm::text AS "areaM2",
  opening_count AS "openingCount", product_system_id::text AS "productSystemId",
  style_id::text AS "styleId", industry_ids::text[] AS "industryIds", budget_tier_id::text AS "budgetTierId", zone_ids::text[] AS "zoneIds",
  feature_ids::text[] AS "featureIds", description, keywords, source, visual_theme AS "visualTheme",
  publish_status AS "publishStatus",
  verification_status AS "verificationStatus", notes, revision AS "editRevision", created_by::text AS "createdBy",
  updated_by::text AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt"
`;

const columnByInput: Record<keyof SchemeInput, string> = {
  code: 'code', name: 'name', parentCode: 'parent_code', lengthMm: 'length_mm', widthMm: 'width_mm',
  heightMm: 'height_mm', areaM2: 'area_sqm', openingCount: 'opening_count',
  productSystemId: 'product_system_id', styleId: 'style_id', industryIds: 'industry_ids', budgetTierId: 'budget_tier_id',
  zoneIds: 'zone_ids', featureIds: 'feature_ids', description: 'description', keywords: 'keywords',
  source: 'source', visualTheme: 'visual_theme',
  notes: 'notes',
};

function requestError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toSchemeRecord(row: SchemeRow): SchemeRecord {
  return { ...row, createdAt: toIsoString(row.createdAt), updatedAt: toIsoString(row.updatedAt) };
}

function hasInput(input: SchemeInput, key: keyof SchemeInput): boolean {
  return Object.hasOwn(input, key);
}

function calculatedArea(input: SchemeInput): number | null | undefined {
  if (input.lengthMm !== undefined && input.lengthMm !== null && input.widthMm !== undefined && input.widthMm !== null) {
    const calculated = input.lengthMm * input.widthMm / 1_000_000;
    if (input.areaM2 !== undefined && input.areaM2 !== null && Math.abs(input.areaM2 - calculated) > 0.000001) throw requestError('Area conflicts with dimensions', 400);
    return calculated;
  }
  return hasInput(input, 'areaM2') ? input.areaM2 : undefined;
}

function comparable(value: unknown): unknown {
  if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return value;
}

/** 返回与当前记录实际不同的输入字段；面积由长宽推导时不单独比较。手动编辑与导入覆盖共用。 */
export function changedSchemeFields(current: Omit<SchemeRecord, 'createdAt' | 'updatedAt'>, input: SchemeInput): (keyof SchemeInput)[] {
  const changed: (keyof SchemeInput)[] = [];
  for (const key of Object.keys(columnByInput) as (keyof SchemeInput)[]) {
    if (key === 'code' || key === 'areaM2' || !hasInput(input, key)) continue;
    if (!isDeepStrictEqual(comparable(current[key]), comparable(input[key]))) changed.push(key);
  }
  const lengthMm = hasInput(input, 'lengthMm') ? input.lengthMm : current.lengthMm;
  const widthMm = hasInput(input, 'widthMm') ? input.widthMm : current.widthMm;
  const areaDerived = lengthMm !== null && lengthMm !== undefined && widthMm !== null && widthMm !== undefined;
  if (hasInput(input, 'areaM2') && !areaDerived) {
    const previous = current.areaM2 === null ? null : Number(current.areaM2);
    const next = input.areaM2 ?? null;
    if (previous === null || next === null ? previous !== next : Math.abs(previous - next) > 0.000001) changed.push('areaM2');
  }
  return changed;
}

function validateDimensions(input: SchemeInput): void {
  for (const value of [input.lengthMm, input.widthMm, input.heightMm]) {
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)) throw requestError('Dimensions must be positive integer millimeters', 400);
  }
}

/** 按字面包含匹配的 ILIKE 模式：转义用户输入里的 `%`、`_` 与反斜杠。 */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}

export async function listSchemes(pool: pg.Pool, options: ListSchemesOptions): Promise<{ data: SchemeRecord[]; total: number; page: number; pageSize: number }> {
  const conditions: string[] = [];
  const values: (string | string[])[] = [];
  const add = (condition: string, value: string) => {
    values.push(value);
    conditions.push(condition.replace('?', `$${values.length}`));
  };
  if (options.keyword) {
    values.push(containsPattern(options.keyword));
    conditions.push(`(code ILIKE $${values.length} OR name ILIKE $${values.length})`);
  }
  if (options.code) add('code ILIKE ?', containsPattern(options.code));
  if (options.name) add('name ILIKE ?', containsPattern(options.name));
  if (options.styleId) add('style_id = ?::uuid', options.styleId);
  if (options.industryId) add('?::uuid = ANY(industry_ids)', options.industryId);
  if (options.productSystemId) add('product_system_id = ?::uuid', options.productSystemId);
  if (options.publishStatus) add('publish_status = ?', options.publishStatus);
  if (options.verificationStatus) add('verification_status = ?', options.verificationStatus);
  if (options.openingCount !== undefined) add('opening_count = ?', String(options.openingCount));
  if (options.budgetTierId) add('budget_tier_id = ?::uuid', options.budgetTierId);
  if (options.zoneIds && options.zoneIds.length > 0) {
    values.push(options.zoneIds);
    conditions.push(`zone_ids && $${values.length}::uuid[]`);
  }
  if (options.featureIds && options.featureIds.length > 0) {
    values.push(options.featureIds);
    conditions.push(`feature_ids && $${values.length}::uuid[]`);
  }
  if (options.parentCode) add('parent_code = ?', options.parentCode);
  const clause = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
  const sortColumn = options.sortBy === 'createdAt' ? 'created_at' : 'updated_at';
  const sortDir = options.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const offset = (options.page - 1) * options.pageSize;
  const [records, count] = await Promise.all([
    pool.query<SchemeRow>(`SELECT ${schemeColumns} FROM schemes${clause} ORDER BY ${sortColumn} ${sortDir} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, options.pageSize, offset]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM schemes${clause}`, values),
  ]);
  return { data: records.rows.map(toSchemeRecord), total: Number(count.rows[0]?.total ?? 0), page: options.page, pageSize: options.pageSize };
}

/** 按编号批量读取方案；lock 为 true 时须在事务内调用，按编号顺序加行锁。 */
export async function findSchemesByCodes(client: pg.Pool | pg.PoolClient, codes: string[], lock = false): Promise<SchemeRecord[]> {
  if (codes.length === 0) return [];
  const result = await client.query<SchemeRow>(
    `SELECT ${schemeColumns} FROM schemes WHERE code = ANY($1::text[]) ORDER BY code${lock ? ' FOR UPDATE' : ''}`, [codes]);
  return result.rows.map(toSchemeRecord);
}

export async function getScheme(pool: pg.Pool, code: string): Promise<SchemeRecord> {
  const result = await pool.query<SchemeRow>(`SELECT ${schemeColumns} FROM schemes WHERE code = $1`, [code]);
  const row = result.rows[0];
  if (!row) throw requestError('Scheme not found', 404);
  return toSchemeRecord(row);
}

export async function createScheme(pool: pg.Pool, adminId: string, input: SchemeInput): Promise<SchemeRecord> {
  if ('publishStatus' in input || 'verificationStatus' in input) throw requestError('Publication and verification require review', 400);
  validateDimensions(input);
  return transaction(pool, client => createSchemeRecord(client, adminId, input));
}

async function createSchemeRecord(pool: pg.PoolClient, adminId: string, input: SchemeInput): Promise<SchemeRecord> {
  const code = input.code?.trim();
  const name = input.name?.trim();
  if (!code || !name) throw requestError('Code and name are required', 400);
  await validateSchemeDictionaryIds(pool, input);
  const existing = await pool.query('SELECT 1 FROM schemes WHERE code = $1', [code]);
  if (existing.rowCount) throw requestError('Scheme code already exists', 409);

  const values: unknown[] = [code, name, adminId, adminId];
  const columns = ['code', 'name', 'created_by', 'updated_by'];
  const placeholders = ['$1', '$2', '$3', '$4'];
  for (const key of Object.keys(columnByInput) as (keyof SchemeInput)[]) {
    if (key === 'code' || key === 'name' || key === 'areaM2' || !hasInput(input, key)) continue;
    columns.push(columnByInput[key]);
    values.push(input[key]);
    placeholders.push(`$${values.length}`);
  }
  const area = calculatedArea(input);
  if (area !== undefined) {
    columns.push('area_sqm');
    values.push(area);
    placeholders.push(`$${values.length}`);
  }
  const result = await pool.query<SchemeRow>(`INSERT INTO schemes (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${schemeColumns}`, values);
  const row = result.rows[0];
  if (!row) throw requestError('Failed to create scheme', 500);
  await ensureSelectionSizes(pool, [row]);
  await writeAuditLog(pool, {
    adminId,
    action: 'scheme.create',
    targetType: 'scheme',
    targetId: row.code,
    detail: { revision: row.editRevision },
  });
  return toSchemeRecord(row);
}

export async function deleteScheme(pool: pg.Pool, adminId: string, code: string): Promise<void> {
  const result = await pool.query('DELETE FROM schemes WHERE code = $1', [code]);
  if (!result.rowCount) throw requestError('Scheme not found', 404);
  await writeAuditLog(pool, {
    adminId,
    action: 'scheme.delete',
    targetType: 'scheme',
    targetId: code,
    detail: {},
  });
}

export async function updateScheme(pool: pg.Pool, code: string, adminId: string, input: SchemeInput, expectedRevision: number): Promise<SchemeRecord> {
  if ('publishStatus' in input || 'verificationStatus' in input) throw requestError('Publication and verification require review', 400);
  if (hasInput(input, 'code')) throw requestError('Scheme code cannot be changed', 400);
  validateDimensions(input);
  return transaction(pool, client => updateSchemeRecord(client, code, adminId, input, expectedRevision));
}

async function updateSchemeRecord(pool: pg.PoolClient, code: string, adminId: string, input: SchemeInput, expectedRevision: number): Promise<SchemeRecord> {
  await validateSchemeDictionaryIds(pool, input);
  const currentResult = await pool.query<SchemeRow>(`SELECT ${schemeColumns} FROM schemes WHERE code = $1 FOR UPDATE`, [code]);
  const current = currentResult.rows[0];
  if (!current) throw requestError('Scheme not found', 404);
  if (current.editRevision !== expectedRevision) throw requestError('Scheme revision conflict', 409);
  if (input.areaM2 !== undefined && input.areaM2 !== null) {
    const lengthMm = hasInput(input, 'lengthMm') ? input.lengthMm : current.lengthMm;
    const widthMm = hasInput(input, 'widthMm') ? input.widthMm : current.widthMm;
    if (lengthMm !== null && lengthMm !== undefined && widthMm !== null && widthMm !== undefined &&
      Math.abs(input.areaM2 - lengthMm * widthMm / 1_000_000) > 0.000001) throw requestError('Area conflicts with dimensions', 400);
  }
  const changed = changedSchemeFields(current, input);
  if (changed.length === 0) return toSchemeRecord(current);
  // 仅内部备注变更不影响匹配、资产与交付：不递增修订、不使审核失效、不下架
  const notesOnly = changed.every(key => key === 'notes');
  const values: unknown[] = [];
  const updates: string[] = [];
  for (const key of Object.keys(columnByInput) as (keyof SchemeInput)[]) {
    if (key === 'code' || key === 'areaM2' || !hasInput(input, key)) continue;
    values.push(input[key]);
    updates.push(`${columnByInput[key]} = $${values.length}`);
  }
  if (hasInput(input, 'lengthMm') || hasInput(input, 'widthMm') || hasInput(input, 'areaM2')) {
    const requestedArea = `$${values.length + 1}::numeric`;
    const length = hasInput(input, 'lengthMm') ? updates.find(update => update.startsWith('length_mm = '))!.split(' = ')[1]! : 'length_mm';
    const width = hasInput(input, 'widthMm') ? updates.find(update => update.startsWith('width_mm = '))!.split(' = ')[1]! : 'width_mm';
    if (input.areaM2 !== undefined && input.areaM2 !== null) {
      values.push(input.areaM2);
      updates.push(`area_sqm = CASE WHEN ${length} IS NOT NULL AND ${width} IS NOT NULL THEN ${length}::numeric * ${width}::numeric / 1000000 ELSE ${requestedArea} END`);
    } else {
      updates.push(`area_sqm = CASE WHEN ${length} IS NOT NULL AND ${width} IS NOT NULL THEN ${length}::numeric * ${width}::numeric / 1000000 ELSE NULL END`);
    }
  }
  if (updates.length === 0) throw requestError('No fields to update', 400);
  values.push(adminId);
  updates.push(`updated_by = $${values.length}`, 'updated_at = now()');
  if (!notesOnly) updates.push('revision = revision + 1', "publish_status = CASE WHEN publish_status = 'published' THEN 'draft' ELSE publish_status END", "verification_status = 'unverified'");
  values.push(code, expectedRevision);
  const result = await pool.query<SchemeRow>(`UPDATE schemes SET ${updates.join(', ')} WHERE code = $${values.length - 1} AND revision = $${values.length} RETURNING ${schemeColumns}`, values);
  const row = result.rows[0];
  if (row) {
    await ensureSelectionSizes(pool, [row]);
    await writeAuditLog(pool, {
      adminId,
      action: 'scheme.update',
      targetType: 'scheme',
      targetId: row.code,
      detail: { revision: row.editRevision, fields: changed },
    });
    return toSchemeRecord(row);
  }
  const exists = await pool.query('SELECT 1 FROM schemes WHERE code = $1', [code]);
  if (!exists.rowCount) throw requestError('Scheme not found', 404);
  throw requestError('Scheme revision conflict', 409);
}
