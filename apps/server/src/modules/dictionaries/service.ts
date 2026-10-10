import type pg from 'pg';
import { canonicalLocale, normalizeDictionaryTerm, type DictionaryAlias } from './language.js';

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
  labels?: Record<string, string>;
  aliases?: DictionaryAlias[];
}

export interface DictionaryItemRecord {
  id: string;
  dictionaryId: string;
  itemValue: string;
  itemLabel: string;
  labels: Record<string, string>;
  aliases: DictionaryAlias[];
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
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
const itemColumns = 'id, dictionary_id AS "dictionaryId", item_value AS "itemValue", item_label AS "itemLabel", labels, aliases, length_mm AS "lengthMm", width_mm AS "widthMm", height_mm AS "heightMm", description, enabled, sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"';
const dictionaryFields: Record<keyof DictionaryInput, string> = {
  code: 'code', name: 'name', type: 'type', description: 'description', enabled: 'enabled', sortOrder: 'sort_order',
};
const itemFields: Record<keyof DictionaryItemInput, string> = {
  itemValue: 'item_value', itemLabel: 'item_label', description: 'description', enabled: 'enabled', sortOrder: 'sort_order',
  labels: 'labels', aliases: 'aliases',
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
    if (key === 'labels' || key === 'aliases') value = JSON.stringify(value);
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }
  return { assignments, values };
}

function translateConstraint(error: unknown, message: string): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw requestError(message, 409);
  throw error;
}

function validateNames(input: DictionaryItemInput): void {
  const localePattern = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;
  if (input.labels !== undefined) {
    const labels: Record<string, string> = {};
    for (const [locale, text] of Object.entries(input.labels)) {
      if (!localePattern.test(locale) || typeof text !== 'string' || !text.trim()) throw requestError('Invalid translated label', 400);
      const key = canonicalLocale(locale);
      if (labels[key]) throw requestError('Duplicate translation locale', 400);
      labels[key] = text.trim();
    }
    input.labels = labels;
  }
  if (input.aliases !== undefined) {
    const aliases = new Map<string, DictionaryAlias>();
    for (const alias of input.aliases) {
      if (!localePattern.test(alias.locale) || !alias.text.trim()) throw requestError('Invalid dictionary alias', 400);
      const locale = canonicalLocale(alias.locale);
      aliases.set(`${locale}:${normalizeDictionaryTerm(alias.text)}`, { locale, text: alias.text.trim() });
    }
    input.aliases = [...aliases.values()];
  }
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
  if (protectedDictionary.rows[0] && ['product_system','style','industry','budget_tier','functional_zone','key_feature','opening_count','booth_size'].includes(protectedDictionary.rows[0].code)) throw requestError('Selection dictionaries cannot be deleted', 409);
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
  validateNames(input);
  const parent = await pool.query<{ code: string }>('SELECT code FROM dictionaries WHERE id = $1', [dictionaryId]);
  if (!parent.rows[0]) throw requestError('Dictionary not found', 404);
  if (parent.rows[0].code === 'booth_size') {
    const dimensions = input.itemValue.trim().split('-').map(Number);
    if (dimensions.length !== 3 || dimensions.some(value => !Number.isSafeInteger(value) || value <= 0 || value > 2147483647)
      || dimensions.join('-') !== input.itemValue.trim()) throw requestError('尺寸值须为长-宽-高的整数毫米，例如 6000-3000-4500', 400);
    const result = await pool.query<DictionaryItemRow>(`INSERT INTO dictionary_items
      (dictionary_id, item_value, item_label, labels, aliases, description, enabled, sort_order, length_mm, width_mm, height_mm)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${itemColumns}`,
    [dictionaryId, input.itemValue.trim(), input.itemLabel.trim(), JSON.stringify(input.labels ?? {}), JSON.stringify(input.aliases ?? []),
      input.description ?? null, input.enabled ?? true, input.sortOrder ?? 0, ...dimensions]).catch(error => translateConstraint(error, 'Dictionary item value already exists'));
    return toItem(result.rows[0]!);
  }
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
  validateNames(input);
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
  const sizeUsed = await pool.query<{ used: boolean }>(`SELECT EXISTS (SELECT 1 FROM dictionary_items i JOIN schemes s
    ON s.length_mm = i.length_mm AND s.width_mm = i.width_mm AND s.height_mm = i.height_mm WHERE i.id = $1) AS used`, [itemId]);
  if (sizeUsed.rows[0]?.used) throw requestError('Dictionary size is referenced by schemes; disable it instead', 409);
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

export interface DictionarySeed {
  code: string;
  name: string;
  type: string;
}

export interface DictionaryItemSeed {
  value: string;
  label: string;
  sortOrder: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  labels?: Record<string, string>;
}

/** 幂等确保字典及条目存在；已有字典和条目保持原样，返回新增条目数。 */
export async function ensureDictionaryItems(client: pg.Pool | pg.PoolClient, dictionary: DictionarySeed, items: DictionaryItemSeed[]): Promise<number> {
  await client.query(
    'INSERT INTO dictionaries (code, name, type) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING',
    [dictionary.code, dictionary.name, dictionary.type],
  );
  let created = 0;
  for (const item of items) {
    const result = await client.query(
      `INSERT INTO dictionary_items (dictionary_id, item_value, item_label, sort_order, length_mm, width_mm, height_mm, labels)
       SELECT id, $2, $3, $4, $5, $6, $7, $8 FROM dictionaries WHERE code = $1
       ON CONFLICT (dictionary_id, item_value) DO NOTHING`,
      [dictionary.code, item.value, item.label, item.sortOrder, item.lengthMm ?? null, item.widthMm ?? null, item.heightMm ?? null, JSON.stringify(item.labels ?? {})],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

/** 按字典项 ID 取名称（含已停用项），用于回显历史快照中保存的条件。 */
export async function dictionaryItemLabels(db: pg.Pool | pg.PoolClient, ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const result = await db.query<{ id: string; label: string }>(
    'SELECT id::text AS id, item_label AS label FROM dictionary_items WHERE id::text = ANY($1::text[])', [ids]);
  return Object.fromEntries(result.rows.map(row => [row.id, row.label]));
}
