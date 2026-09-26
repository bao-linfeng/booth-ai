import type pg from 'pg';
import { transaction } from '../../../infra/database.js';

export interface CatalogOptionInput {
  key: string;
  label: string;
  sortOrder?: number;
  enabled?: boolean;
}

export interface CatalogOption {
  key: string;
  label: string;
  sortOrder: number;
  enabled: boolean;
}

interface CatalogOptionRow extends CatalogOption {
  type: string;
}

function requestError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export async function getCatalogOptions(pool: pg.Pool, types?: string[]): Promise<Record<string, CatalogOption[]>> {
  const params = types && types.length > 0 ? [types] : [];
  const filter = params.length > 0 ? ' WHERE type = ANY($1::text[])' : '';
  const result = await pool.query<CatalogOptionRow>(`SELECT type, key, label, sort_order AS "sortOrder", enabled FROM catalog_options${filter} ORDER BY type, sort_order, key`, params);
  return result.rows.reduce<Record<string, CatalogOption[]>>((grouped, option) => {
    const options = grouped[option.type] ?? [];
    options.push({ key: option.key, label: option.label, sortOrder: option.sortOrder, enabled: option.enabled });
    grouped[option.type] = options;
    return grouped;
  }, {});
}

export async function updateCatalogOptionsByType(pool: pg.Pool, type: string, options: CatalogOptionInput[]): Promise<Record<string, CatalogOption[]>> {
  const normalized = options.map((option, index) => ({
    key: option.key.trim(),
    label: option.label.trim(),
    sortOrder: option.sortOrder ?? index,
    enabled: option.enabled ?? true,
  }));
  const keys = new Set<string>();
  for (const option of normalized) {
    if (!/^[a-z0-9_]+$/.test(option.key)) throw requestError('Catalog option key must contain lowercase letters, numbers, or underscores', 400);
    if (!option.label) throw requestError('Catalog option label is required', 400);
    if (keys.has(option.key)) throw requestError('Catalog option keys must be unique within a type', 400);
    keys.add(option.key);
  }
  await transaction(pool, async client => {
    await client.query('DELETE FROM catalog_options WHERE type = $1', [type]);
    for (const option of normalized) {
      await client.query(
        'INSERT INTO catalog_options (type, key, label, sort_order, enabled) VALUES ($1, $2, $3, $4, $5)',
        [type, option.key, option.label, option.sortOrder, option.enabled],
      );
    }
  });
  return getCatalogOptions(pool, [type]);
}
