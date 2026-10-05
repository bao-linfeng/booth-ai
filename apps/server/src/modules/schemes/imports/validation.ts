import type pg from 'pg';
import type { ImportPreviewRow, ImportRow } from './types.js';
import { resolveDictionaryTerms, type DictionaryAlias } from '../../selection/dictionary-language.js';

const importDictionaries = {
  productSystemId: 'product_system', styleId: 'style', industryIds: 'industry',
  budgetTierId: 'budget_tier', zoneIds: 'functional_zone', featureIds: 'key_feature',
} as const;

type ImportDictionaryField = keyof typeof importDictionaries;

/** 将行内字典标签（或条目值）解析为字典条目 id，任一标签未映射则抛 400。 */
async function resolveImportLabels(client: pg.Pool | pg.PoolClient, row: ImportRow): Promise<ImportRow> {
  const result = { ...row };
  for (const [field, code] of Object.entries(importDictionaries) as [ImportDictionaryField, string][]) {
    const value = row[field];
    if (value === null) continue;
    const labels = Array.isArray(value) ? value : [value];
    if (labels.length === 0) continue;
    const matches = await client.query<{ id: string; label: string; itemValue: string; labels: Record<string, string>; aliases: DictionaryAlias[] }>(`
      SELECT i.id::text AS id, i.item_label AS label, i.item_value AS "itemValue", i.labels, i.aliases
      FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id
      WHERE d.code = $1 AND d.enabled AND i.enabled`, [code]);
    const ids = resolveDictionaryTerms(matches.rows.map(item => ({ ...item, value: item.itemValue })), labels);
    (result as Record<ImportDictionaryField, string | string[] | null>)[field] = Array.isArray(value) ? ids as string[] : ids[0]!;
  }
  return result;
}

export function validateImportedSize(row: ImportRow): void {
  for (const dimension of [row.lengthMm, row.widthMm, row.heightMm]) {
    if (dimension !== null && (!Number.isSafeInteger(dimension) || dimension <= 0 || dimension > 2147483647))
      throw Object.assign(new Error('尺寸无法精确表示为整数毫米'), { statusCode: 400 });
  }
  if (row.areaM2 !== null && (!Number.isFinite(row.areaM2) || row.areaM2 <= 0))
    throw Object.assign(new Error('面积必须为正数'), { statusCode: 400 });
  if (row.areaM2 !== null && row.lengthMm !== null && row.widthMm !== null &&
    Math.abs(row.areaM2 - row.lengthMm * row.widthMm / 1_000_000) > 0.000001)
    throw Object.assign(new Error('面积与长宽不一致'), { statusCode: 400 });
}

/** 预览阶段的行校验：尺寸合法性 + 字典标签解析，返回标签已替换为 id 的行。 */
export async function validateImportRow(client: pg.Pool | pg.PoolClient, row: ImportRow): Promise<ImportRow> {
  validateImportedSize(row);
  return resolveImportLabels(client, row);
}

/** 缺少编号或名称时返回原因，否则返回 null。 */
export function missingRequiredField(row: ImportRow): string | null {
  if (row.code === '') return 'Scheme code is required';
  if (row.name === '') return 'Scheme name is required';
  return null;
}

/** 从预览 JSON 还原一行，结构不合法时返回 null。 */
export function importRowFromJson(value: unknown): ImportPreviewRow | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<ImportPreviewRow>;
  if (typeof row.rowNumber !== 'number' || typeof row.code !== 'string' || typeof row.name !== 'string' ||
    (row.status !== 'valid' && row.status !== 'duplicate' && row.status !== 'error')) return null;
  return row as ImportPreviewRow;
}
