import type pg from 'pg';
import { ensureLabeledDictionaryItem } from '../../dictionaries/service.js';
import type { ImportRow } from './types.js';
import {
  dictionaryFieldValues,
  importDictionaries,
  newDictionaryItemLabel,
  resolveImportTerm,
  type ImportDictionaries,
  type ImportDictionaryField,
} from './validation.js';

export interface CreatedDictionaryItem {
  dictionaryCode: string;
  id: string;
  label: string;
}

const fields = Object.entries(importDictionaries) as [ImportDictionaryField, string][];

/** 行内是否含提交时需新建的字典名称。 */
export function hasNewDictionaryItems(row: ImportRow): boolean {
  return fields.some(([field]) => dictionaryFieldValues(row, field).some(value => newDictionaryItemLabel(value) !== null));
}

/**
 * 将行内的新建占位值替换为条目 id：预览之后已有同名条目（他人新建、前面的行已新建或别名命中）时直接复用，否则新建。
 * 返回替换后的行与本行实际新建的条目；调用方在该行写入成功后再把新条目并入快照，失败时随 SAVEPOINT 一起回滚。
 */
export async function materializeNewDictionaryItems(
  client: pg.PoolClient,
  dictionaries: ImportDictionaries,
  row: ImportRow,
): Promise<{ data: ImportRow; created: CreatedDictionaryItem[] }> {
  const data = { ...row };
  const created: CreatedDictionaryItem[] = [];
  for (const [field, dictionaryCode] of fields) {
    const values = dictionaryFieldValues(row, field);
    if (!values.some(value => newDictionaryItemLabel(value) !== null)) continue;
    const ids = new Set<string>();
    for (const value of values) {
      const label = newDictionaryItemLabel(value);
      if (label === null) {
        ids.add(value);
        continue;
      }
      const existing = resolveImportTerm(dictionaries, dictionaryCode, label);
      if (existing) {
        ids.add(existing);
        continue;
      }
      const item = await ensureLabeledDictionaryItem(client, dictionaryCode, label);
      if (item.created) created.push({ dictionaryCode, id: item.id, label });
      ids.add(item.id);
    }
    (data as Record<ImportDictionaryField, string | string[] | null>)[field] = Array.isArray(row[field]) ? [...ids] : [...ids][0]!;
  }
  return { data, created };
}
