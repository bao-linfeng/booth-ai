import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type pg from 'pg';
import { commitImport, previewImport } from '../src/modules/admin/scheme-imports/service.js';
import type { ImportRow } from '../src/modules/admin/scheme-imports/service.js';

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

test('preview snapshots duplicate revisions in the stored rows', async () => {
  const buffer = await readFile(new URL('../../../docs/source/灵通展台方案打标模板.xlsx', import.meta.url));
  let duplicateCode: string | undefined;
  let savedRows: string | undefined;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT code FROM schemes')) {
        duplicateCode = (params[0] as string[])[0];
        return { rows: [{ code: duplicateCode }] };
      }
      if (sql.includes('SELECT code, revision FROM schemes')) {
        assert.deepEqual(params[0], [duplicateCode]);
        return { rows: [{ code: duplicateCode, revision: 7 }] };
      }
      if (sql.includes('FROM dictionary_items')) {
        return { rows: (params[1] as string[]).map(label => ({ id: '00000000-0000-4000-8000-000000000001', label, itemValue: label })) };
      }
      if (sql.includes('INSERT INTO scheme_imports')) {
        savedRows = params[1] as string;
        return { rows: [{ id: '00000000-0000-4000-8000-000000000002' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;

  const result = await previewImport(pool, null, buffer, 'template.xlsx');
  assert.equal(result.summary.duplicate, 1);
  assert.equal(result.rows.find(row => row.code === duplicateCode)?.snapshotRevision, 7);
  assert.deepEqual(JSON.parse(savedRows!), result.rows);
});

test('commit replays the stored result for matching options and rejects different options', async () => {
  const committedResult = { created: 1, updated: 0, dictionaryItemsCreated: 0, failed: [] };
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM scheme_imports')) {
        return { rows: [{ status: 'committed', preview: [], commit_request_hash: createHash('sha256').update(JSON.stringify(['import-1', 'skip', null])).digest('hex'), committed_result: committedResult }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;

  assert.deepEqual(await commitImport(pool, null, 'import-1', { duplicateStrategy: 'skip' }), committedResult);
  await assert.rejects(commitImport(pool, null, 'import-1', { duplicateStrategy: 'update' }), { statusCode: 409 });
  assert.equal(queries.filter(sql => sql.includes('UPDATE schemes')).length, 0);
  assert.ok(queries.some(sql => sql.includes('SELECT preview, status, commit_request_hash, committed_result')));
});

test('commit rejects duplicate rows when the preview revision is stale or missing', async () => {
  const data: ImportRow = {
    code: 'S1', name: 'Scheme', parentCode: null, widthMm: null, lengthMm: null, areaM2: null,
    heightMm: null, openingCount: null, productSystemId: null, styleId: null, industryIds: null,
    budgetTierId: null, zoneIds: null, featureIds: null, description: null, keywords: null,
    verificationStatus: 'unverified', notes: null,
  };
  let savedResult: string | undefined;
  let updateCount = 0;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM scheme_imports')) return { rows: [{ status: 'pending', preview: [
        { rowNumber: 2, code: 'S1', name: 'Scheme', status: 'duplicate', data, snapshotRevision: 4 },
        { rowNumber: 3, code: 'S2', name: 'Scheme', status: 'duplicate', data: { ...data, code: 'S2' } },
      ] }] };
      if (sql.includes('UPDATE schemes')) {
        updateCount += 1;
        assert.match(sql, /WHERE code = \$1 AND revision = \$19/);
        assert.equal(params?.[18], 4);
        return { rowCount: 0 };
      }
      if (sql.includes('UPDATE scheme_imports')) savedResult = params?.[2] as string;
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  const result = await commitImport(pool, null, 'import-1', { duplicateStrategy: 'update' });
  assert.equal(updateCount, 1);
  assert.deepEqual(result.failed, [
    { rowNumber: 2, code: 'S1', reason: '方案已被他人修改，请重新导入' },
    { rowNumber: 3, code: 'S2', reason: '预览数据缺少版本信息' },
  ]);
  assert.deepEqual(JSON.parse(savedResult!), result);
});
