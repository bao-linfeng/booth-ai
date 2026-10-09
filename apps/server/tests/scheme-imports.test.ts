import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type pg from 'pg';
import { commitImport } from '../src/modules/schemes/imports/commit.js';
import { previewImport } from '../src/modules/schemes/imports/preview.js';
import type { ImportRow } from '../src/modules/schemes/imports/types.js';
import { maxImportRows, maxImportSheets, parseWorkbook } from '../src/modules/schemes/imports/workbook.js';

async function templateItems() {
  const rows = await parseWorkbook(await readFile(new URL('../../../docs/source/灵通展台方案打标模板.xlsx', import.meta.url)));
  const fields: Record<string, keyof ImportRow> = { product_system: 'productSystemId', style: 'styleId', industry: 'industryIds', budget_tier: 'budgetTierId', functional_zone: 'zoneIds', key_feature: 'featureIds' };
  return Object.entries(fields).flatMap(([dictionaryCode, field]) => [...new Set(rows.flatMap(row => {
    const value = row.data[field];
    return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  }))].map((label, index) => ({ dictionaryCode, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, label, itemValue: label })));
}

test('the scheme template preview stores JSON rows and summary for commit', async () => {
  const dictionaryItems = await templateItems();
  const file = new URL('../../../docs/source/灵通展台方案打标模板.xlsx', import.meta.url);
  const buffer = await readFile(file);
  let savedRows: unknown;
  let savedSummary: unknown;
  let dictionaryQueries = 0;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT code FROM schemes')) return { rows: [] };
      if (sql.includes('FROM dictionary_items')) {
        dictionaryQueries += 1;
        return { rows: dictionaryItems };
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
  assert.equal(result.summary.total, 75);
  assert.equal(result.summary.skipped, 27);
  assert.equal(result.rows.length, 48);
  assert.ok(result.rows.every(row => row.status === 'valid'));
  assert.equal(result.rows[0]?.data?.lengthMm, 6000);
  assert.equal(result.rows[0]?.data?.widthMm, 3000);
  assert.equal(typeof savedRows, 'string');
  assert.deepEqual(JSON.parse(savedRows as string), result.rows);
  assert.equal(typeof savedSummary, 'string');
  assert.deepEqual(JSON.parse(savedSummary as string), result.summary);
  assert.equal(dictionaryQueries, 1);
});

test('preview snapshots duplicate revisions in the stored rows', async () => {
  const dictionaryItems = await templateItems();
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
      if (sql.includes('FROM dictionary_items')) return { rows: dictionaryItems };
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
        { rowId: 1, sheetName: '方案', rowNumber: 2, code: 'S1', name: 'Scheme', status: 'duplicate', data, snapshotRevision: 4 },
        { rowId: 2, sheetName: '方案', rowNumber: 3, code: 'S2', name: 'Scheme', status: 'duplicate', data: { ...data, code: 'S2' } },
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
    { rowId: 1, sheetName: '方案', rowNumber: 2, code: 'S1', reason: '方案已被他人修改，请重新导入' },
    { rowId: 2, sheetName: '方案', rowNumber: 3, code: 'S2', reason: '预览数据缺少版本信息' },
  ]);
  assert.deepEqual(JSON.parse(savedResult!), result);
});

test('commit isolates failing rows with savepoints and creates generated dictionary items for written rows', async () => {
  const base: ImportRow = {
    code: 'S1', name: 'Scheme', parentCode: null, widthMm: 3000, lengthMm: 6000, areaM2: 18,
    heightMm: 4500, openingCount: 2, productSystemId: null, styleId: null, industryIds: null,
    budgetTierId: null, zoneIds: null, featureIds: null, description: null, keywords: null,
    verificationStatus: 'unverified', notes: null,
  };
  const queries: string[] = [];
  const itemInserts: unknown[][] = [];
  let savedResult: string | undefined;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push(sql.trim().split('\n')[0]!.trim());
      if (sql.includes('FROM scheme_imports')) return { rows: [{ status: 'pending', preview: [
        { rowId: 1, sheetName: '方案', rowNumber: 2, code: 'S1', name: 'Scheme', status: 'valid', data: base },
        { rowId: 2, sheetName: '方案', rowNumber: 3, code: 'S2', name: 'Scheme', status: 'valid', data: { ...base, code: 'S2', widthMm: 0.5 } },
        { rowId: 3, sheetName: '方案', rowNumber: 4, code: 'S3', name: 'Scheme', status: 'valid', data: { ...base, code: 'S3', parentCode: 'MISSING' } },
      ] }] };
      if (sql.includes('INSERT INTO schemes') && params?.[0] === 'S3') throw new Error('violates foreign key constraint on parent_code');
      if (sql.includes('INSERT INTO dictionary_items')) { itemInserts.push(params ?? []); return { rowCount: 1, rows: [] }; }
      if (sql.includes('UPDATE scheme_imports')) savedResult = params?.[2] as string;
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;

  const result = await commitImport(pool, 'admin-1', 'import-1', { duplicateStrategy: 'skip' });
  assert.equal(result.created, 1);
  assert.deepEqual(result.failed, [
    { rowId: 2, sheetName: '方案', rowNumber: 3, code: 'S2', reason: '尺寸无法精确表示为整数毫米' },
    { rowId: 3, sheetName: '方案', rowNumber: 4, code: 'S3', reason: '母方案不存在' },
  ]);
  assert.equal(queries.filter(sql => sql === 'SAVEPOINT row_save').length, 3);
  assert.equal(queries.filter(sql => sql === 'ROLLBACK TO SAVEPOINT row_save').length, 2);
  assert.deepEqual(itemInserts.map(params => [params[0], params[1]]), [
    ['opening_count', '2'], ['booth_size', '6000-3000-4500'],
  ]);
  assert.equal(result.dictionaryItemsCreated, 2);
  assert.deepEqual(JSON.parse(savedResult!), result);
});

async function multiSheetWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('填写说明').addRows([['说明'], ['', 'IGNORED', '不应导入']]);
  const first = workbook.addWorksheet('华东');
  first.addRows([['序号', '方案编号', '方案名称'], ['1', 'A-1', '方案一']]);
  const second = workbook.addWorksheet('华南');
  second.addRows([['序号', '方案编号', '方案名称'], ['1', 'B-1', '方案二'], [], ['3', 'A-1', '重复方案'], ['4', 'B-2', '']]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('multi-sheet preview keeps each row sheet name and source row number with a unique row id', async () => {
  let savedRows: string | undefined;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT code FROM schemes')) return { rows: [] };
      if (sql.includes('FROM dictionary_items')) return { rows: [] };
      if (sql.includes('INSERT INTO scheme_imports')) {
        savedRows = params[1] as string;
        return { rows: [{ id: '00000000-0000-4000-8000-000000000002' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;

  const result = await previewImport(pool, null, await multiSheetWorkbook(), 'multi.xlsx');
  assert.deepEqual(result.rows.map(({ rowId, sheetName, rowNumber, code, status, reason }) => ({ rowId, sheetName, rowNumber, code, status, reason })), [
    { rowId: 1, sheetName: '华东', rowNumber: 2, code: 'A-1', status: 'valid', reason: undefined },
    { rowId: 2, sheetName: '华南', rowNumber: 2, code: 'B-1', status: 'valid', reason: undefined },
    { rowId: 4, sheetName: '华南', rowNumber: 4, code: 'A-1', status: 'error', reason: '文件内方案编号重复（首次出现于「华东」第 2 行）' },
    { rowId: 5, sheetName: '华南', rowNumber: 5, code: 'B-2', status: 'error', reason: 'Scheme name is required' },
  ]);
  assert.deepEqual(result.summary, { total: 5, valid: 2, duplicate: 0, error: 2, skipped: 1 });
  assert.deepEqual(JSON.parse(savedRows!), result.rows);
});

test('commit selects rows by row id and reports failures with their source sheet and row', async () => {
  const base: ImportRow = {
    code: 'A-1', name: 'Scheme', parentCode: null, widthMm: null, lengthMm: null, areaM2: null,
    heightMm: null, openingCount: null, productSystemId: null, styleId: null, industryIds: null,
    budgetTierId: null, zoneIds: null, featureIds: null, description: null, keywords: null,
    verificationStatus: 'unverified', notes: null,
  };
  const inserted: unknown[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM scheme_imports')) return { rows: [{ status: 'pending', preview: [
        { rowId: 1, sheetName: '华东', rowNumber: 2, code: 'A-1', name: 'Scheme', status: 'valid', data: base },
        { rowId: 2, sheetName: '华南', rowNumber: 2, code: 'B-1', name: 'Scheme', status: 'valid', data: { ...base, code: 'B-1', parentCode: 'MISSING' } },
      ] }] };
      if (sql.includes('INSERT INTO schemes')) {
        inserted.push(params?.[0]);
        if (params?.[0] === 'B-1') throw new Error('violates foreign key constraint on parent_code');
      }
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;

  const result = await commitImport(pool, null, 'import-1', { duplicateStrategy: 'skip', selectedRowIds: [2] });
  assert.deepEqual(inserted, ['B-1']);
  assert.equal(result.created, 0);
  assert.deepEqual(result.failed, [{ rowId: 2, sheetName: '华南', rowNumber: 2, code: 'B-1', reason: '母方案不存在' }]);
});

test('workbook parsing ignores formatted trailing rows and rejects oversized sheet or row ranges', async () => {
  const formatted = new ExcelJS.Workbook();
  const sheet = formatted.addWorksheet('方案');
  sheet.addRows([['序号', '方案编号', '方案名称'], ['1', 'A-1', '方案一']]);
  sheet.getRow(100000).getCell(2).style = { font: { bold: true } };
  const rows = await parseWorkbook(Buffer.from(await formatted.xlsx.writeBuffer()));
  assert.deepEqual(rows.map(row => [row.rowNumber, row.data.code]), [[2, 'A-1']]);

  const farRow = new ExcelJS.Workbook();
  farRow.addWorksheet('方案').getRow(maxImportRows + 2).getCell(2).value = 'FAR';
  await assert.rejects(parseWorkbook(Buffer.from(await farRow.xlsx.writeBuffer())), { statusCode: 400, reason: 'IMPORT_TOO_MANY_ROWS' });

  const manySheets = new ExcelJS.Workbook();
  for (let index = 0; index <= maxImportSheets; index += 1) manySheets.addWorksheet(`方案${index}`).addRow(['序号', '方案编号', '方案名称']);
  manySheets.addWorksheet('填写说明');
  await assert.rejects(parseWorkbook(Buffer.from(await manySheets.xlsx.writeBuffer())), { statusCode: 400, reason: 'IMPORT_TOO_MANY_SHEETS' });

  await assert.rejects(parseWorkbook(Buffer.from('not a workbook')), { statusCode: 400, reason: 'IMPORT_FILE_INVALID' });
});
