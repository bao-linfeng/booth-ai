import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type pg from 'pg';
import { previewImport } from '../src/modules/admin/scheme-imports/service.js';

test('the scheme template preview stores JSON rows and summary for commit', async () => {
  const file = new URL('../../../docs/source/灵通展台方案打标模板.xlsx', import.meta.url);
  const buffer = await readFile(file);
  let savedRows: unknown;
  let savedSummary: unknown;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT code FROM schemes')) return { rows: [] };
      if (sql.includes('FROM dictionary_items')) {
        const labels = params[1] as string[];
        return { rows: labels.map(label => ({ id: '00000000-0000-4000-8000-000000000001', label, itemValue: label })) };
      }
      if (sql.includes('INSERT INTO scheme_imports')) {
        assert.equal(params[0], '灵通展台方案打标模板.xlsx');
        savedRows = params[1];
        savedSummary = params[2];
        return { rows: [{ id: '00000000-0000-4000-8000-000000000002' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;

  const result = await previewImport(pool, null, buffer, '灵通展台方案打标模板.xlsx');
  assert.equal(result.summary.total, 85);
  assert.equal(result.summary.skipped, 37);
  assert.equal(result.rows.length, 48);
  assert.ok(result.rows.every(row => row.status === 'valid'));
  assert.equal(typeof savedRows, 'string');
  assert.deepEqual(JSON.parse(savedRows as string), result.rows);
  assert.equal(typeof savedSummary, 'string');
  assert.deepEqual(JSON.parse(savedSummary as string), result.summary);
});
