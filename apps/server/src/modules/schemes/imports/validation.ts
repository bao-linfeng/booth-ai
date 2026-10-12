import type pg from 'pg';
import type { ImportDictionaryLabels, ImportPreviewRow, ImportRow } from './types.js';
import {
  cleanDictionaryTerm,
  indexDictionaryTerms,
  normalizeDictionaryTerm,
  type DictionaryAlias,
  type DictionaryTermIndex,
} from '../../dictionaries/language.js';

export const importDictionaries = {
  productSystemId: 'product_system',
  styleId: 'style',
  industryIds: 'industry',
  budgetTierId: 'budget_tier',
  zoneIds: 'functional_zone',
  featureIds: 'key_feature',
} as const;

export type ImportDictionaryField = keyof typeof importDictionaries;

/**
 * 导入涉及字典的快照：按字典编码分别索引启用与停用条目的词条，并保留条目 id → 中文标签以便回显映射结果。
 * 停用条目只用于识别“名称已被停用条目占用”，避免自动新建出同名条目。
 */
export interface ImportDictionaries {
  terms: Map<string, DictionaryTermIndex>;
  disabledTerms: Map<string, DictionaryTermIndex>;
  labels: Map<string, string>;
}

/** 一次查询加载导入涉及的全部字典条目；提交阶段仍由 validateSchemeDictionaryIds 复核有效性。 */
export async function loadImportDictionaries(client: pg.Pool | pg.PoolClient): Promise<ImportDictionaries> {
  const codes = Object.values(importDictionaries);
  const result = await client.query<{
    dictionaryCode: string;
    id: string;
    label: string;
    itemValue: string;
    labels: Record<string, string>;
    aliases: DictionaryAlias[];
    enabled: boolean;
  }>(
    `
    SELECT d.code AS "dictionaryCode", i.id::text AS id, i.item_label AS label, i.item_value AS "itemValue", i.labels, i.aliases,
      i.enabled
    FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id
    WHERE d.code = ANY($1::text[]) AND d.enabled`,
    [codes],
  );
  const index = (enabled: boolean) =>
    new Map(
      codes.map(code => [
        code,
        indexDictionaryTerms(
          result.rows
            .filter(item => item.dictionaryCode === code && item.enabled === enabled)
            .map(item => ({ ...item, value: item.itemValue })),
        ),
      ]),
    );
  return { terms: index(true), disabledTerms: index(false), labels: new Map(result.rows.map(item => [item.id, item.label])) };
}

const newItemPrefix = 'new:';

/** 字典中尚不存在的名称在预览数据里的占位值，提交时新建条目后替换为 id。 */
export function newDictionaryItemToken(label: string): string {
  return `${newItemPrefix}${label}`;
}

/** 占位值对应的条目名称；条目 id 返回 null。 */
export function newDictionaryItemLabel(value: string): string | null {
  return value.startsWith(newItemPrefix) ? value.slice(newItemPrefix.length) : null;
}

/** 将一个名称解析为启用条目 id；不存在时返回 null。名称有多个候选或只匹配停用条目时抛 400。 */
export function resolveImportTerm(dictionaries: ImportDictionaries, dictionaryCode: string, term: string): string | null {
  const normalized = normalizeDictionaryTerm(term);
  const matches = [...(dictionaries.terms.get(dictionaryCode)?.get(normalized) ?? [])];
  if (matches.length > 1) throw Object.assign(new Error(`标签存在多个候选，请确认：${term}`), { statusCode: 400 });
  if (matches[0]) return matches[0];
  if (dictionaries.disabledTerms.get(dictionaryCode)?.has(normalized))
    throw Object.assign(new Error(`字典项已停用，请先启用：${term}`), { statusCode: 400 });
  return null;
}

/** 将新建的条目加入快照，后续行按名称或条目值即可匹配到它。 */
export function addImportedDictionaryItem(dictionaries: ImportDictionaries, dictionaryCode: string, id: string, label: string): void {
  const index = dictionaries.terms.get(dictionaryCode) ?? new Map<string, Set<string>>();
  index.set(normalizeDictionaryTerm(label), new Set([id]));
  dictionaries.terms.set(dictionaryCode, index);
  dictionaries.labels.set(id, label);
}

/** 字典字段的取值列表（单选字段包装为单元素数组）。 */
export function dictionaryFieldValues(row: ImportRow, field: ImportDictionaryField): string[] {
  const value = row[field];
  return value === null ? [] : Array.isArray(value) ? value : [value];
}

/** 将行内字典标签（或条目值）解析为字典条目 id；字典中不存在的名称保留为新建占位值，同一字段内按名称去重。 */
function resolveImportLabels(dictionaries: ImportDictionaries, row: ImportRow): ImportRow {
  const result = { ...row };
  for (const [field, code] of Object.entries(importDictionaries) as [ImportDictionaryField, string][]) {
    const terms = dictionaryFieldValues(row, field);
    if (terms.length === 0) continue;
    const resolved = new Map<string, string>();
    for (const term of terms) {
      const id = resolveImportTerm(dictionaries, code, term);
      const key = id ?? normalizeDictionaryTerm(term);
      if (!resolved.has(key)) resolved.set(key, id ?? newDictionaryItemToken(cleanDictionaryTerm(term)));
    }
    const values = [...resolved.values()];
    (result as Record<ImportDictionaryField, string | string[] | null>)[field] = Array.isArray(row[field]) ? values : values[0]!;
  }
  return result;
}

/** 字典字段对应的中文标签（含待新建的名称），用于预览展示映射结果。 */
export function importDictionaryLabels(dictionaries: ImportDictionaries, row: ImportRow): ImportDictionaryLabels {
  const labels: ImportDictionaryLabels = {};
  for (const field of Object.keys(importDictionaries) as ImportDictionaryField[]) {
    const values = dictionaryFieldValues(row, field);
    if (values.length > 0) labels[field] = values.map(value => newDictionaryItemLabel(value) ?? dictionaries.labels.get(value) ?? value);
  }
  return labels;
}

/** 提交时将自动新建的条目名称，按字段列出；没有时返回 undefined。 */
export function importNewDictionaryLabels(row: ImportRow): ImportDictionaryLabels | undefined {
  const labels: ImportDictionaryLabels = {};
  for (const field of Object.keys(importDictionaries) as ImportDictionaryField[]) {
    const created = dictionaryFieldValues(row, field).flatMap(value => newDictionaryItemLabel(value) ?? []);
    if (created.length > 0) labels[field] = created;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

export function validateImportedSize(row: ImportRow): void {
  for (const dimension of [row.lengthMm, row.widthMm, row.heightMm]) {
    if (dimension !== null && (!Number.isSafeInteger(dimension) || dimension <= 0 || dimension > 2147483647))
      throw Object.assign(new Error('尺寸无法精确表示为整数毫米'), { statusCode: 400 });
  }
  if (row.areaM2 !== null && (!Number.isFinite(row.areaM2) || row.areaM2 <= 0))
    throw Object.assign(new Error('面积必须为正数'), { statusCode: 400 });
  if (
    row.areaM2 !== null &&
    row.lengthMm !== null &&
    row.widthMm !== null &&
    Math.abs(row.areaM2 - (row.lengthMm * row.widthMm) / 1_000_000) > 0.000001
  )
    throw Object.assign(new Error('面积与长宽不一致'), { statusCode: 400 });
}

/** 预览阶段的行校验：尺寸合法性 + 字典标签解析，返回标签已替换为 id（或新建占位值）的行。 */
export function validateImportRow(dictionaries: ImportDictionaries, row: ImportRow): ImportRow {
  validateImportedSize(row);
  return resolveImportLabels(dictionaries, row);
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
  if (
    typeof row.rowId !== 'number' ||
    typeof row.sheetName !== 'string' ||
    typeof row.rowNumber !== 'number' ||
    typeof row.code !== 'string' ||
    typeof row.name !== 'string' ||
    (row.status !== 'valid' && row.status !== 'duplicate' && row.status !== 'unchanged' && row.status !== 'error')
  )
    return null;
  return row as ImportPreviewRow;
}
