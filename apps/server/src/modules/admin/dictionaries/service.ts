import type pg from 'pg';

export interface DictionaryInput {
  code?: string;
  name?: string;
  type?: string;
  description?: string | null;
  enabled?: boolean;
  sortOrder?: number;
}

export interface DictionaryRecord {
  id: string;
  code: string;
  name: string;
  type: string;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryDetailRecord extends DictionaryRecord {
  items: DictionaryItemRecord[];
}

export interface DictionaryItemInput {
  itemValue?: string;
  itemLabel?: string;
  description?: string | null;
  enabled?: boolean;
  sortOrder?: number;
}

export interface DictionaryItemRecord {
  id: string;
  dictionaryId: string;
  itemValue: string;
  itemLabel: string;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListDictionariesOptions {
  page: number;
  pageSize: number;
  code?: string;
  name?: string;
  type?: string;
  enabled?: boolean;
}

interface DictionaryRow extends Omit<DictionaryRecord, 'createdAt' | 'updatedAt'> {
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface DictionaryItemRow extends Omit<DictionaryItemRecord, 'createdAt' | 'updatedAt'> {
  createdAt: Date | string;
  updatedAt: Date | string;
}

const dictionaryColumns = 'id, code, name, type, description, enabled, sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"';
const itemColumns = 'id, dictionary_id AS "dictionaryId", item_value AS "itemValue", item_label AS "itemLabel", description, enabled, sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"';
const dictionaryFields: Record<keyof DictionaryInput, string> = {
  code: 'code', name: 'name', type: 'type', description: 'description', enabled: 'enabled', sortOrder: 'sort_order',
};
const itemFields: Record<keyof DictionaryItemInput, string> = {
  itemValue: 'item_value', itemLabel: 'item_label', description: 'description', enabled: 'enabled', sortOrder: 'sort_order',
};

function requestError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDictionary(row: DictionaryRow): DictionaryRecord {
  return { ...row, createdAt: toIsoString(row.createdAt), updatedAt: toIsoString(row.updatedAt) };
}

function toItem(row: DictionaryItemRow): DictionaryItemRecord {
  return { ...row, createdAt: toIsoString(row.createdAt), updatedAt: toIsoString(row.updatedAt) };
}

function fieldsFor<T extends object>(input: T, columns: Record<keyof T, string>): { assignments: string[]; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (!Object.hasOwn(input, key)) continue;
    let value: unknown = input[key as keyof T];
    if ((key === 'code' || key === 'name' || key === 'itemValue' || key === 'itemLabel') && typeof value === 'string') {
      value = value.trim();
      if (!value) throw requestError(`${key} is required`, 400);
    }
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }
  return { assignments, values };
}

function translateConstraint(error: unknown, message: string): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw requestError(message, 409);
  throw error;
}

export async function listDictionaries(pool: pg.Pool, options: ListDictionariesOptions): Promise<{ data: DictionaryRecord[]; total: number; page: number; pageSize: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const add = (condition: string, value: unknown) => {
    values.push(value);
    conditions.push(condition.replace('?', `$${values.length}`));
  };
  if (options.code) add('d.code ILIKE ?', `%${options.code}%`);
  if (options.name) add('d.name ILIKE ?', `%${options.name}%`);
  if (options.type) add('d.type = ?', options.type);
  if (options.enabled !== undefined) add('d.enabled = ?', options.enabled);
  const clause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const [records, count] = await Promise.all([
    pool.query<DictionaryRow>(`SELECT d.id, d.code, d.name, d.type, d.description, d.enabled, d.sort_order AS "sortOrder", d.created_at AS "createdAt", d.updated_at AS "updatedAt", (SELECT count(*)::int FROM dictionary_items i WHERE i.dictionary_id = d.id) AS "itemCount" FROM dictionaries d${clause} ORDER BY d.sort_order, d.created_at DESC, d.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, options.pageSize, (options.page - 1) * options.pageSize]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM dictionaries d${clause}`, values),
  ]);
  return { data: records.rows.map(toDictionary), total: Number(count.rows[0]?.total ?? 0), page: options.page, pageSize: options.pageSize };
}

export async function getDictionary(pool: pg.Pool, id: string): Promise<DictionaryDetailRecord> {
  const result = await pool.query<DictionaryRow>(`SELECT ${dictionaryColumns} FROM dictionaries WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw requestError('Dictionary not found', 404);
  return { ...toDictionary(row), items: await listDictionaryItems(pool, id) };
}

export async function createDictionary(pool: pg.Pool, input: DictionaryInput): Promise<DictionaryRecord> {
  if (!input.code?.trim() || !input.name?.trim()) throw requestError('Code and name are required', 400);
  if (!input.type?.trim()) throw requestError('Type is required', 400);
  const { assignments, values } = fieldsFor(input, dictionaryFields);
  const columns = assignments.map(assignment => assignment.split(' = ')[0]);
  try {
    const result = await pool.query<DictionaryRow>(`INSERT INTO dictionaries (${columns.join(', ')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING ${dictionaryColumns}`, values);
    return toDictionary(result.rows[0]!);
  } catch (error) {
    return translateConstraint(error, 'Dictionary code already exists');
  }
}

export async function updateDictionary(pool: pg.Pool, id: string, input: DictionaryInput): Promise<DictionaryRecord> {
  if (input.code !== undefined || input.type !== undefined) throw requestError('Dictionary code and type cannot be changed', 400);
  const { assignments, values } = fieldsFor(input, dictionaryFields);
  if (!assignments.length) throw requestError('No fields to update', 400);
  try {
    const result = await pool.query<DictionaryRow>(`UPDATE dictionaries SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length + 1} RETURNING ${dictionaryColumns}`, [...values, id]);
    if (!result.rows[0]) throw requestError('Dictionary not found', 404);
    return toDictionary(result.rows[0]);
  } catch (error) {
    return translateConstraint(error, 'Dictionary code already exists');
  }
}

export async function deleteDictionary(pool: pg.Pool, id: string): Promise<void> {
  const protectedDictionary = await pool.query<{ code: string }>('SELECT code FROM dictionaries WHERE id = $1', [id]);
  if (protectedDictionary.rows[0] && ['product_system','style','industry','budget_tier','functional_zone','key_feature'].includes(protectedDictionary.rows[0].code)) throw requestError('Selection dictionaries cannot be deleted', 409);
  const used = await pool.query<{ used: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM dictionary_items i JOIN schemes s ON
      s.product_system_id = i.id OR s.style_id = i.id OR s.budget_tier_id = i.id
      OR i.id = ANY(s.industry_ids) OR i.id = ANY(s.zone_ids) OR i.id = ANY(s.feature_ids)
    WHERE i.dictionary_id = $1
  ) AS used`, [id]);
  if (used.rows[0]?.used) throw requestError('Dictionary is referenced by schemes; disable it instead', 409);
  const result = await pool.query('DELETE FROM dictionaries WHERE id = $1', [id]);
  if (!result.rowCount) throw requestError('Dictionary not found', 404);
}

export async function listDictionaryItems(pool: pg.Pool, dictionaryId: string): Promise<DictionaryItemRecord[]> {
  const result = await pool.query<DictionaryItemRow>(`SELECT ${itemColumns} FROM dictionary_items WHERE dictionary_id = $1 ORDER BY sort_order, created_at, id`, [dictionaryId]);
  if (!result.rows.length) {
    const parent = await pool.query('SELECT 1 FROM dictionaries WHERE id = $1', [dictionaryId]);
    if (!parent.rowCount) throw requestError('Dictionary not found', 404);
  }
  return result.rows.map(toItem);
}

export async function createDictionaryItem(pool: pg.Pool, dictionaryId: string, input: DictionaryItemInput): Promise<DictionaryItemRecord> {
  if (!input.itemValue?.trim() || !input.itemLabel?.trim()) throw requestError('Item value and label are required', 400);
  const { assignments, values } = fieldsFor(input, itemFields);
  const columns = assignments.map(assignment => assignment.split(' = ')[0]);
  try {
    const result = await pool.query<DictionaryItemRow>(`INSERT INTO dictionary_items (dictionary_id, ${columns.join(', ')}) VALUES ($1, ${values.map((_, index) => `$${index + 2}`).join(', ')}) RETURNING ${itemColumns}`, [dictionaryId, ...values]);
    return toItem(result.rows[0]!);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23503') throw requestError('Dictionary not found', 404);
    return translateConstraint(error, 'Dictionary item value already exists');
  }
}

export async function updateDictionaryItem(pool: pg.Pool, itemId: string, input: DictionaryItemInput, dictionaryId?: string): Promise<DictionaryItemRecord> {
  if (input.itemValue !== undefined) throw requestError('Dictionary item value cannot be changed', 400);
  const { assignments, values } = fieldsFor(input, itemFields);
  if (!assignments.length) throw requestError('No fields to update', 400);
  const scope = dictionaryId === undefined ? '' : ` AND dictionary_id = $${values.length + 2}`;
  try {
    const result = await pool.query<DictionaryItemRow>(`UPDATE dictionary_items SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length + 1}${scope} RETURNING ${itemColumns}`, dictionaryId === undefined ? [...values, itemId] : [...values, itemId, dictionaryId]);
    if (!result.rows[0]) throw requestError('Dictionary item not found', 404);
    return toItem(result.rows[0]);
  } catch (error) {
    return translateConstraint(error, 'Dictionary item value already exists');
  }
}

export async function deleteDictionaryItem(pool: pg.Pool, itemId: string, dictionaryId?: string): Promise<void> {
  const used = await pool.query<{ used: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM schemes WHERE product_system_id = $1 OR style_id = $1 OR budget_tier_id = $1
      OR $1 = ANY(industry_ids) OR $1 = ANY(zone_ids) OR $1 = ANY(feature_ids)
  ) AS used`, [itemId]);
  if (used.rows[0]?.used) throw requestError('Dictionary item is referenced by schemes; disable it instead', 409);
  const result = dictionaryId === undefined
    ? await pool.query('DELETE FROM dictionary_items WHERE id = $1', [itemId])
    : await pool.query('DELETE FROM dictionary_items WHERE id = $1 AND dictionary_id = $2', [itemId, dictionaryId]);
  if (!result.rowCount) throw requestError('Dictionary item not found', 404);
}
