import type pg from 'pg';
import { ensureDictionaryItems } from './dictionaries.js';

export interface SizeSource {
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  openingCount: number | null;
}

export async function ensureSelectionSizes(client: pg.Pool | pg.PoolClient, rows: SizeSource[]): Promise<number> {
  const sizes = new Map<string, { value: string; label: string; sortOrder: number; lengthMm: number; widthMm: number; heightMm: number }>();
  const openings = new Set<number>();
  for (const row of rows) {
    if (row.openingCount !== null) openings.add(row.openingCount);
    if (row.lengthMm === null || row.widthMm === null || row.heightMm === null) continue;
    const value = `${row.lengthMm}-${row.widthMm}-${row.heightMm}`;
    sizes.set(value, { value, label: `${row.lengthMm / 1000} × ${row.widthMm / 1000} × ${row.heightMm / 1000} m`,
      sortOrder: 0, lengthMm: row.lengthMm, widthMm: row.widthMm, heightMm: row.heightMm });
  }
  const openingCount = await ensureDictionaryItems(client, { code: 'opening_count', name: '开口面数', type: 'selection' },
    [...openings].map(value => ({ value: String(value), label: value === 4 ? '4面开口（岛式）' : `${value}面开口`, sortOrder: value,
      labels: { en: `${value} open ${value === 1 ? 'side' : 'sides'}`, ja: `${value}面開放` } })));
  const sizeCount = await ensureDictionaryItems(client, { code: 'booth_size', name: '方案尺寸（长×宽×高）', type: 'selection' }, [...sizes.values()]);
  return openingCount + sizeCount;
}
