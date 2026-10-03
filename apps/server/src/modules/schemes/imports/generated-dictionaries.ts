import type pg from 'pg';
import { ensureDictionaryItems, type DictionaryItemSeed } from '../../selection/dictionaries.js';
import type { ImportRow } from './types.js';

const generatedDictionaries = [
  { code: 'opening_count', name: '开口面数' },
  { code: 'booth_length', name: '展位长' },
  { code: 'booth_width', name: '展位宽' },
  { code: 'booth_height', name: '展位高' },
  { code: 'booth_area', name: '展位面积' },
] as const;

type GeneratedDictionaryCode = (typeof generatedDictionaries)[number]['code'];

function generatedDictionaryItem(code: GeneratedDictionaryCode, row: ImportRow): DictionaryItemSeed | null {
  if (code === 'opening_count' && row.openingCount !== null) {
    return {
      value: String(row.openingCount),
      label: row.openingCount === 4 ? '4面开口（岛式）' : `${row.openingCount}面开口`,
      sortOrder: row.openingCount,
    };
  }
  const dimension = code === 'booth_length' ? row.lengthMm : code === 'booth_width' ? row.widthMm : code === 'booth_height' ? row.heightMm : null;
  if (dimension !== null) {
    return { value: String(dimension), label: `${dimension / 1000} m`, sortOrder: dimension };
  }
  if (code === 'booth_area' && row.areaM2 !== null) {
    return { value: String(row.areaM2), label: `${row.areaM2} ㎡`, sortOrder: Math.round(row.areaM2 * 1_000_000) };
  }
  return null;
}

/** 按已提交行的开口面数与尺寸补齐选型字典条目，返回新增条目数。 */
export async function createGeneratedDictionaryItems(client: pg.PoolClient, rows: ImportRow[]): Promise<number> {
  let created = 0;
  for (const dictionary of generatedDictionaries) {
    const items = new Map<string, DictionaryItemSeed>();
    for (const row of rows) {
      const item = generatedDictionaryItem(dictionary.code, row);
      if (item) items.set(item.value, item);
    }
    created += await ensureDictionaryItems(client, { ...dictionary, type: 'selection' }, [...items.values()]);
  }
  return created;
}
