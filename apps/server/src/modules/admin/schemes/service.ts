import type pg from 'pg';

export interface SchemeInput {
  code?: string;
  name?: string;
  parentCode?: string | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  areaSqm?: number | null;
  openingCount?: number | null;
  openingDirections?: string[] | null;
  productLine?: string | null;
  style?: string | null;
  industries?: string[] | null;
  budgetTier?: string | null;
  functionalZones?: string[] | null;
  keyFeatures?: string[] | null;
  description?: string | null;
  keywords?: string[] | null;
  source?: string | null;
  visualTheme?: string | null;
  applicableConditions?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface ListSchemesOptions {
  page: number;
  pageSize: number;
  code?: string;
  name?: string;
  style?: string;
  industry?: string;
  productLine?: string;
  publishStatus?: string;
  verificationStatus?: string;
  parentCode?: string;
}

export interface SchemeRecord {
  id: string;
  code: string;
  name: string;
  parentCode: string | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  areaSqm: string | null;
  openingCount: number | null;
  openingDirections: string[] | null;
  productLine: string | null;
  style: string | null;
  industries: string[] | null;
  budgetTier: string | null;
  functionalZones: string[] | null;
  keyFeatures: string[] | null;
  description: string | null;
  keywords: string[] | null;
  source: string | null;
  visualTheme: string | null;
  applicableConditions: Record<string, unknown> | null;
  publishStatus: string;
  verificationStatus: string;
  notes: string | null;
  revision: number;
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
  id, code, name, parent_code AS "parentCode", length_cm::text AS "lengthCm",
  width_cm::text AS "widthCm", height_cm::text AS "heightCm", area_sqm::text AS "areaSqm",
  opening_count AS "openingCount", opening_directions AS "openingDirections", product_line AS "productLine",
  style, industries, budget_tier AS "budgetTier", functional_zones AS "functionalZones",
  key_features AS "keyFeatures", description, keywords, source, visual_theme AS "visualTheme",
  applicable_conditions AS "applicableConditions", publish_status AS "publishStatus",
  verification_status AS "verificationStatus", notes, revision, created_by::text AS "createdBy",
  updated_by::text AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt"
`;

const columnByInput: Record<keyof SchemeInput, string> = {
  code: 'code', name: 'name', parentCode: 'parent_code', lengthCm: 'length_cm', widthCm: 'width_cm',
  heightCm: 'height_cm', areaSqm: 'area_sqm', openingCount: 'opening_count', openingDirections: 'opening_directions',
  productLine: 'product_line', style: 'style', industries: 'industries', budgetTier: 'budget_tier',
  functionalZones: 'functional_zones', keyFeatures: 'key_features', description: 'description', keywords: 'keywords',
  source: 'source', visualTheme: 'visual_theme', applicableConditions: 'applicable_conditions',
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
  if (hasInput(input, 'areaSqm')) return input.areaSqm;
  if (input.lengthCm !== undefined && input.lengthCm !== null && input.widthCm !== undefined && input.widthCm !== null) {
    return input.lengthCm * input.widthCm / 10000;
  }
  return undefined;
}

export async function listSchemes(pool: pg.Pool, options: ListSchemesOptions): Promise<{ data: SchemeRecord[]; total: number; page: number; pageSize: number }> {
  const conditions: string[] = [];
  const values: string[] = [];
  const add = (condition: string, value: string) => {
    values.push(value);
    conditions.push(condition.replace('?', `$${values.length}`));
  };
  if (options.code) add('code ILIKE ?', `%${options.code}%`);
  if (options.name) add('name ILIKE ?', `%${options.name}%`);
  if (options.style) add('style = ?', options.style);
  if (options.industry) add('? = ANY(industries)', options.industry);
  if (options.productLine) add('product_line = ?', options.productLine);
  if (options.publishStatus) add('publish_status = ?', options.publishStatus);
  if (options.verificationStatus) add('verification_status = ?', options.verificationStatus);
  if (options.parentCode) add('parent_code = ?', options.parentCode);
  const clause = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;
  const offset = (options.page - 1) * options.pageSize;
  const [records, count] = await Promise.all([
    pool.query<SchemeRow>(`SELECT ${schemeColumns} FROM schemes${clause} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, options.pageSize, offset]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM schemes${clause}`, values),
  ]);
  return { data: records.rows.map(toSchemeRecord), total: Number(count.rows[0]?.total ?? 0), page: options.page, pageSize: options.pageSize };
}

export async function getScheme(pool: pg.Pool, code: string): Promise<SchemeRecord> {
  const result = await pool.query<SchemeRow>(`SELECT ${schemeColumns} FROM schemes WHERE code = $1`, [code]);
  const row = result.rows[0];
  if (!row) throw requestError('Scheme not found', 404);
  return toSchemeRecord(row);
}

export async function createScheme(pool: pg.Pool, adminId: string | null, input: SchemeInput): Promise<SchemeRecord> {
  if ('publishStatus' in input || 'verificationStatus' in input) throw requestError('Publication and verification require review', 400);
  const code = input.code?.trim();
  const name = input.name?.trim();
  if (!code || !name) throw requestError('Code and name are required', 400);
  const existing = await pool.query('SELECT 1 FROM schemes WHERE code = $1', [code]);
  if (existing.rowCount) throw requestError('Scheme code already exists', 409);

  const values: unknown[] = [code, name, adminId, adminId];
  const columns = ['code', 'name', 'created_by', 'updated_by'];
  const placeholders = ['$1', '$2', '$3', '$4'];
  for (const key of Object.keys(columnByInput) as (keyof SchemeInput)[]) {
    if (key === 'code' || key === 'name' || !hasInput(input, key)) continue;
    columns.push(columnByInput[key]);
    values.push(input[key]);
    placeholders.push(`$${values.length}`);
  }
  const area = calculatedArea(input);
  if (area !== undefined && !hasInput(input, 'areaSqm')) {
    columns.push('area_sqm');
    values.push(area);
    placeholders.push(`$${values.length}`);
  }
  const result = await pool.query<SchemeRow>(`INSERT INTO schemes (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${schemeColumns}`, values);
  const row = result.rows[0];
  if (!row) throw requestError('Failed to create scheme', 500);
  return toSchemeRecord(row);
}

export async function deleteScheme(pool: pg.Pool, code: string): Promise<void> {
  const result = await pool.query('DELETE FROM schemes WHERE code = $1', [code]);
  if (!result.rowCount) throw requestError('Scheme not found', 404);
}

export async function updateScheme(pool: pg.Pool, code: string, adminId: string | null, input: SchemeInput, expectedRevision: number): Promise<SchemeRecord> {
  if ('publishStatus' in input || 'verificationStatus' in input) throw requestError('Publication and verification require review', 400);
  if (hasInput(input, 'code')) throw requestError('Scheme code cannot be changed', 400);
  const values: unknown[] = [];
  const updates: string[] = [];
  for (const key of Object.keys(columnByInput) as (keyof SchemeInput)[]) {
    if (key === 'code' || !hasInput(input, key)) continue;
    values.push(input[key]);
    updates.push(`${columnByInput[key]} = $${values.length}`);
  }
  const area = calculatedArea(input);
  if (area !== undefined && !hasInput(input, 'areaSqm')) {
    values.push(area);
    updates.push(`area_sqm = $${values.length}`);
  }
  if (updates.length === 0) throw requestError('No fields to update', 400);
  values.push(adminId);
  updates.push(`updated_by = $${values.length}`, 'updated_at = now()', 'revision = revision + 1', "publish_status = CASE WHEN publish_status = 'published' THEN 'draft' ELSE publish_status END", "verification_status = 'unverified'");
  values.push(code, expectedRevision);
  const result = await pool.query<SchemeRow>(`UPDATE schemes SET ${updates.join(', ')} WHERE code = $${values.length - 1} AND revision = $${values.length} RETURNING ${schemeColumns}`, values);
  const row = result.rows[0];
  if (row) return toSchemeRecord(row);
  const exists = await pool.query('SELECT 1 FROM schemes WHERE code = $1', [code]);
  if (!exists.rowCount) throw requestError('Scheme not found', 404);
  throw requestError('Scheme revision conflict', 409);
}
