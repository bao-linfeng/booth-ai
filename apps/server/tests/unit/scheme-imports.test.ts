import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type pg from 'pg';
import { commitImport } from '../../src/modules/schemes/imports/commit.js';
import { previewImport } from '../../src/modules/schemes/imports/preview.js';
import type { ImportPreviewRow, ImportRow } from '../../src/modules/schemes/imports/types.js';
import type { SchemeRecord } from '../../src/modules/schemes/service.js';
import { buildImportTemplate } from '../../src/modules/schemes/imports/template.js';
import { importColumns, maxImportRows, maxImportSheets, parseWorkbook } from '../../src/modules/schemes/imports/workbook.js';

const header = importColumns.map(column => column.header);

async function templateItems() {
  const rows = await parseWorkbook(await readFile(new URL('../../../../docs/source/灵通展台方案打标模板.xlsx', import.meta.url)));
  const fields: Record<string, keyof ImportRow> = {
    product_system: 'productSystemId',
    style: 'styleId',
    industry: 'industryIds',
    budget_tier: 'budgetTierId',
    functional_zone: 'zoneIds',
    key_feature: 'featureIds',
  };
  return Object.entries(fields)
    .flatMap(([dictionaryCode, field]) =>
      [
        ...new Set(
          rows.flatMap(row => {
            const value = row.data[field];
            return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
          }),
        ),
      ].map(label => ({ dictionaryCode, label, itemValue: label })),
    )
    .map((item, index) => ({ ...item, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
}

test('the scheme template preview stores JSON rows and summary for commit', async () => {
  const dictionaryItems = await templateItems();
  const file = new URL('../../../../docs/source/灵通展台方案打标模板.xlsx', import.meta.url);
  const buffer = await readFile(file);
  let savedRows: unknown;
  let savedSummary: unknown;
  let dictionaryQueries = 0;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM schemes WHERE code = ANY')) return { rows: [] };
      if (sql.includes('FROM dictionary_items')) {
        dictionaryQueries += 1;
        return { rows: dictionaryItems };
      }
      if (sql.includes('INSERT INTO scheme_imports')) {
        assert.equal(params[0], '灵通展台方案打标模板.xlsx');
        savedRows = params[1];
        savedSummary = params[2];
        return { rows: [{ id: '00000000-0000-4000-8000-000000000002', expiresAt: new Date('2026-10-09T01:00:00Z') }] };
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
  assert.equal(result.expiresAt, '2026-10-09T01:00:00.000Z');
  assert.deepEqual(result.rows[0]?.dictionaryLabels?.styleId, ['现代简约']);
  assert.deepEqual(result.rows[0]?.dictionaryLabels?.zoneIds, ['接待区', '展示区', '洽谈区', '储藏间']);
  assert.equal(typeof savedRows, 'string');
  assert.deepEqual(JSON.parse(savedRows as string), result.rows);
  assert.equal(typeof savedSummary, 'string');
  assert.deepEqual(JSON.parse(savedSummary as string), result.summary);
  assert.equal(dictionaryQueries, 1);
});

function schemeRecord(data: ImportRow, overrides: Partial<SchemeRecord> = {}): SchemeRecord {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    code: data.code,
    name: data.name,
    parentCode: data.parentCode,
    lengthMm: data.lengthMm,
    widthMm: data.widthMm,
    heightMm: data.heightMm,
    areaM2: data.areaM2 === null ? null : String(data.areaM2),
    openingCount: data.openingCount,
    productSystemId: data.productSystemId,
    styleId: data.styleId,
    industryIds: data.industryIds ?? [],
    budgetTierId: data.budgetTierId,
    zoneIds: data.zoneIds ?? [],
    featureIds: data.featureIds ?? [],
    description: data.description,
    keywords: data.keywords,
    source: null,
    visualTheme: null,
    publishStatus: 'draft',
    verificationStatus: 'verified',
    notes: data.notes,
    editRevision: 7,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function previewPool(dictionaryItems: unknown[], existing: SchemeRecord[], saved: { rows?: string } = {}): pg.Pool {
  return {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM schemes WHERE code = ANY'))
        return { rows: existing.filter(scheme => (params[0] as string[]).includes(scheme.code)) };
      if (sql.includes('FROM dictionary_items')) return { rows: dictionaryItems };
      if (sql.includes('INSERT INTO scheme_imports')) {
        saved.rows = params[1] as string;
        return { rows: [{ id: '00000000-0000-4000-8000-000000000002', expiresAt: new Date('2026-10-09T01:00:00Z') }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;
}

function pick(row: ImportPreviewRow | undefined) {
  return {
    status: row?.status,
    snapshotRevision: row?.snapshotRevision,
    published: row?.published,
    changedFields: row?.changedFields,
    clearedFields: row?.clearedFields,
  };
}

test('preview compares existing schemes field by field and reports the unpublish impact', async () => {
  const dictionaryItems = await templateItems();
  const buffer = await readFile(new URL('../../../../docs/source/灵通展台方案打标模板.xlsx', import.meta.url));
  const fresh = await previewImport(previewPool(dictionaryItems, []), null, buffer, 'template.xlsx');
  const [same, edited, notesOnly] = fresh.rows.map(row => row.data!);
  const saved: { rows?: string } = {};
  const existing = [
    schemeRecord(same!, { publishStatus: 'published' }),
    schemeRecord(edited!, { name: '旧名称', parentCode: 'P-1', publishStatus: 'published', editRevision: 3 }),
    schemeRecord(notesOnly!, { notes: '内部备注', publishStatus: 'published' }),
  ];
  const result = await previewImport(previewPool(dictionaryItems, existing, saved), null, buffer, 'template.xlsx');

  const byCode = new Map(result.rows.map(row => [row.code, row]));
  assert.deepEqual(pick(byCode.get(same!.code)), {
    status: 'unchanged',
    snapshotRevision: 7,
    published: true,
    changedFields: [],
    clearedFields: [],
  });
  assert.deepEqual(pick(byCode.get(edited!.code)), {
    status: 'duplicate',
    snapshotRevision: 3,
    published: true,
    changedFields: ['name', 'parentCode'],
    clearedFields: ['parentCode'],
  });
  assert.deepEqual(pick(byCode.get(notesOnly!.code)), {
    status: 'duplicate',
    snapshotRevision: 7,
    published: true,
    changedFields: ['notes'],
    clearedFields: ['notes'],
  });
  assert.deepEqual(result.summary, { ...fresh.summary, valid: fresh.summary.valid - 3, duplicate: 2, unchanged: 1, unpublish: 1 });
  assert.deepEqual(JSON.parse(saved.rows!), result.rows);
});

test('commit replays the stored result for matching options and rejects different options', async () => {
  const committedResult = { created: 1, updated: 0, unchanged: 0, dictionaryItemsCreated: 0, failed: [] };
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM scheme_imports')) {
        return {
          rows: [
            {
              status: 'committed',
              preview: [],
              commit_request_hash: createHash('sha256')
                .update(JSON.stringify(['import-1', 'skip', null]))
                .digest('hex'),
              committed_result: committedResult,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;

  assert.deepEqual(await commitImport(pool, null, 'import-1', { duplicateStrategy: 'skip' }), committedResult);
  await assert.rejects(commitImport(pool, null, 'import-1', { duplicateStrategy: 'update' }), {
    statusCode: 409,
    reason: 'IMPORT_ALREADY_COMMITTED',
  });
  assert.equal(queries.filter(sql => sql.includes('UPDATE schemes')).length, 0);
  assert.ok(queries.some(sql => sql.includes('SELECT preview, status, commit_request_hash, committed_result')));
});

test('commit reports an expired or missing preview with a dedicated reason', async () => {
  const client = { query: async () => ({ rows: [] }), release: () => {} };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  await assert.rejects(commitImport(pool, null, 'import-1', { duplicateStrategy: 'skip' }), {
    statusCode: 410,
    reason: 'IMPORT_PREVIEW_EXPIRED',
  });
});

test('commit rejects duplicate rows when the preview revision is stale or missing', async () => {
  const data: ImportRow = {
    code: 'S1',
    name: 'Scheme',
    parentCode: null,
    widthMm: null,
    lengthMm: null,
    areaM2: null,
    heightMm: null,
    openingCount: null,
    productSystemId: null,
    styleId: null,
    industryIds: null,
    budgetTierId: null,
    zoneIds: null,
    featureIds: null,
    description: null,
    keywords: null,
    verificationStatus: 'unverified',
    notes: null,
  };
  let savedResult: string | undefined;
  let updateCount = 0;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM scheme_imports'))
        return {
          rows: [
            {
              status: 'pending',
              preview: [
                { rowId: 1, sheetName: '方案', rowNumber: 2, code: 'S1', name: 'Scheme', status: 'duplicate', data, snapshotRevision: 4 },
                {
                  rowId: 2,
                  sheetName: '方案',
                  rowNumber: 3,
                  code: 'S2',
                  name: 'Scheme',
                  status: 'duplicate',
                  data: { ...data, code: 'S2' },
                },
                {
                  rowId: 3,
                  sheetName: '方案',
                  rowNumber: 4,
                  code: 'S3',
                  name: 'Scheme',
                  status: 'duplicate',
                  data: { ...data, code: 'S3' },
                  snapshotRevision: 4,
                },
              ],
            },
          ],
        };
      if (sql.includes('FROM schemes WHERE code = ANY')) {
        const code = (params![0] as string[])[0];
        assert.match(sql, /FOR UPDATE/);
        return {
          rows:
            code === 'S1'
              ? [schemeRecord(data, { name: 'Old', editRevision: 4 })]
              : code === 'S3'
                ? [schemeRecord(data, { code: 'S3', editRevision: 9 })]
                : [],
        };
      }
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
    { rowId: 3, sheetName: '方案', rowNumber: 4, code: 'S3', reason: '方案已被他人修改，请重新导入' },
  ]);
  assert.deepEqual(JSON.parse(savedResult!), result);
});

test('commit isolates failing rows with savepoints and creates generated dictionary items for written rows', async () => {
  const base: ImportRow = {
    code: 'S1',
    name: 'Scheme',
    parentCode: null,
    widthMm: 3000,
    lengthMm: 6000,
    areaM2: 18,
    heightMm: 4500,
    openingCount: 2,
    productSystemId: null,
    styleId: null,
    industryIds: null,
    budgetTierId: null,
    zoneIds: null,
    featureIds: null,
    description: null,
    keywords: null,
    verificationStatus: 'unverified',
    notes: null,
  };
  const queries: string[] = [];
  const itemInserts: unknown[][] = [];
  let savedResult: string | undefined;
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push(sql.trim().split('\n')[0]!.trim());
      if (sql.includes('FROM scheme_imports'))
        return {
          rows: [
            {
              status: 'pending',
              preview: [
                { rowId: 1, sheetName: '方案', rowNumber: 2, code: 'S1', name: 'Scheme', status: 'valid', data: base },
                {
                  rowId: 2,
                  sheetName: '方案',
                  rowNumber: 3,
                  code: 'S2',
                  name: 'Scheme',
                  status: 'valid',
                  data: { ...base, code: 'S2', widthMm: 0.5 },
                },
                {
                  rowId: 3,
                  sheetName: '方案',
                  rowNumber: 4,
                  code: 'S3',
                  name: 'Scheme',
                  status: 'valid',
                  data: { ...base, code: 'S3', parentCode: 'MISSING' },
                },
              ],
            },
          ],
        };
      if (sql.includes('INSERT INTO schemes') && params?.[0] === 'S3') throw new Error('violates foreign key constraint on parent_code');
      if (sql.includes('INSERT INTO dictionary_items')) {
        itemInserts.push(params ?? []);
        return { rowCount: 1, rows: [] };
      }
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
  assert.deepEqual(
    itemInserts.map(params => [params[0], params[1]]),
    [
      ['opening_count', '2'],
      ['booth_size', '6000-3000-4500'],
    ],
  );
  assert.equal(result.dictionaryItemsCreated, 2);
  assert.deepEqual(JSON.parse(savedResult!), result);
});

async function multiSheetWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('填写说明').addRows([['说明'], ['', 'IGNORED', '不应导入']]);
  const first = workbook.addWorksheet('华东');
  first.addRows([header, ['1', 'A-1', '方案一']]);
  const second = workbook.addWorksheet('华南');
  second.addRows([header, ['1', 'B-1', '方案二'], [], ['3', 'A-1', '重复方案'], ['4', 'B-2', '']]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('multi-sheet preview keeps each row sheet name and source row number with a unique row id', async () => {
  let savedRows: string | undefined;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM schemes WHERE code = ANY')) return { rows: [] };
      if (sql.includes('FROM dictionary_items')) return { rows: [] };
      if (sql.includes('INSERT INTO scheme_imports')) {
        savedRows = params[1] as string;
        return { rows: [{ id: '00000000-0000-4000-8000-000000000002', expiresAt: new Date('2026-10-09T01:00:00Z') }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;

  const result = await previewImport(pool, null, await multiSheetWorkbook(), 'multi.xlsx');
  assert.deepEqual(
    result.rows.map(({ rowId, sheetName, rowNumber, code, status, reason }) => ({ rowId, sheetName, rowNumber, code, status, reason })),
    [
      { rowId: 1, sheetName: '华东', rowNumber: 2, code: 'A-1', status: 'valid', reason: undefined },
      { rowId: 2, sheetName: '华南', rowNumber: 2, code: 'B-1', status: 'valid', reason: undefined },
      {
        rowId: 4,
        sheetName: '华南',
        rowNumber: 4,
        code: 'A-1',
        status: 'error',
        reason: '文件内方案编号重复（首次出现于「华东」第 2 行）',
      },
      { rowId: 5, sheetName: '华南', rowNumber: 5, code: 'B-2', status: 'error', reason: 'Scheme name is required' },
    ],
  );
  assert.deepEqual(result.summary, { total: 5, valid: 2, duplicate: 0, unchanged: 0, error: 2, skipped: 1, unpublish: 0 });
  assert.deepEqual(JSON.parse(savedRows!), result.rows);
});

test('commit selects rows by row id and reports failures with their source sheet and row', async () => {
  const base: ImportRow = {
    code: 'A-1',
    name: 'Scheme',
    parentCode: null,
    widthMm: null,
    lengthMm: null,
    areaM2: null,
    heightMm: null,
    openingCount: null,
    productSystemId: null,
    styleId: null,
    industryIds: null,
    budgetTierId: null,
    zoneIds: null,
    featureIds: null,
    description: null,
    keywords: null,
    verificationStatus: 'unverified',
    notes: null,
  };
  const inserted: unknown[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM scheme_imports'))
        return {
          rows: [
            {
              status: 'pending',
              preview: [
                { rowId: 1, sheetName: '华东', rowNumber: 2, code: 'A-1', name: 'Scheme', status: 'valid', data: base },
                {
                  rowId: 2,
                  sheetName: '华南',
                  rowNumber: 2,
                  code: 'B-1',
                  name: 'Scheme',
                  status: 'valid',
                  data: { ...base, code: 'B-1', parentCode: 'MISSING' },
                },
              ],
            },
          ],
        };
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
  sheet.addRows([header, ['1', 'A-1', '方案一']]);
  sheet.getRow(100000).getCell(2).style = { font: { bold: true } };
  const rows = await parseWorkbook(Buffer.from(await formatted.xlsx.writeBuffer()));
  assert.deepEqual(
    rows.map(row => [row.rowNumber, row.data.code]),
    [[2, 'A-1']],
  );

  const farRow = new ExcelJS.Workbook();
  const far = farRow.addWorksheet('方案');
  far.addRow(header);
  far.getRow(maxImportRows + 2).getCell(2).value = 'FAR';
  await assert.rejects(parseWorkbook(Buffer.from(await farRow.xlsx.writeBuffer())), { statusCode: 400, reason: 'IMPORT_TOO_MANY_ROWS' });

  const manySheets = new ExcelJS.Workbook();
  for (let index = 0; index <= maxImportSheets; index += 1) manySheets.addWorksheet(`方案${index}`).addRow(header);
  manySheets.addWorksheet('填写说明');
  await assert.rejects(parseWorkbook(Buffer.from(await manySheets.xlsx.writeBuffer())), {
    statusCode: 400,
    reason: 'IMPORT_TOO_MANY_SHEETS',
  });

  await assert.rejects(parseWorkbook(Buffer.from('not a workbook')), { statusCode: 400, reason: 'IMPORT_FILE_INVALID' });
});

test('data sheets must keep the template header while blank sheets are ignored', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Sheet1');
  workbook.addWorksheet('方案').addRows([header, ['1', 'A-1', '方案一']]);
  const shifted: string[] = [...header];
  shifted[5] = ' 展位长（m） ';
  workbook.addWorksheet('华南').addRows([shifted, ['1', 'B-1', '方案二']]);
  assert.deepEqual(
    (await parseWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()))).map(row => row.data.code),
    ['A-1', 'B-1'],
  );

  const legacy = new ExcelJS.Workbook();
  legacy.addWorksheet('方案').addRows([header, ['1', 'A-1', '方案一']]);
  const swapped: string[] = [...header];
  [swapped[5], swapped[6]] = [swapped[6]!, swapped[5]!];
  legacy.addWorksheet('其他').addRows([swapped, ['1', 'B-1', '方案二']]);
  await assert.rejects(parseWorkbook(Buffer.from(await legacy.xlsx.writeBuffer())), {
    statusCode: 400,
    reason: 'IMPORT_TEMPLATE_MISMATCH',
    details: { sheetName: '其他', column: 'F', expected: '展位长(m)', actual: '展位宽(m)' },
  });
});

test('the generated template round-trips through the parser and lists enabled dictionary options', async () => {
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      assert.match(sql, /d\.enabled AND i\.enabled/);
      assert.ok((params[0] as string[]).includes('style'));
      return {
        rows: [
          { dictionaryCode: 'style', label: '现代简约' },
          { dictionaryCode: 'industry', label: '服装纺织' },
        ],
      };
    },
  } as unknown as pg.Pool;
  const buffer = await buildImportTemplate(pool);
  assert.deepEqual(await parseWorkbook(buffer), []);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  assert.deepEqual(
    workbook.worksheets.map(sheet => sheet.name),
    ['方案打标', '下拉选项', '填写说明'],
  );
  assert.deepEqual((workbook.getWorksheet('方案打标')!.getRow(1).values as unknown[]).slice(1), header);
  const options = workbook.getWorksheet('下拉选项')!;
  const styleColumn = (options.getRow(1).values as unknown[]).indexOf('风格');
  assert.deepEqual(options.getColumn(styleColumn).values.slice(1), ['风格', '现代简约']);
  assert.equal(workbook.getWorksheet('方案打标')!.getCell('L2').dataValidation?.type, 'list');
  assert.equal(workbook.getWorksheet('方案打标')!.getCell('M2').dataValidation, undefined);
});

test('commit skips unchanged rows, keeps notes-only edits published and fully overwrites real changes', async () => {
  const base: ImportRow = {
    code: 'SAME',
    name: 'Scheme',
    parentCode: null,
    widthMm: 3000,
    lengthMm: 6000,
    areaM2: 18,
    heightMm: 4500,
    openingCount: 2,
    productSystemId: null,
    styleId: null,
    industryIds: null,
    budgetTierId: null,
    zoneIds: null,
    featureIds: null,
    description: null,
    keywords: null,
    verificationStatus: 'unverified',
    notes: null,
  };
  const current = new Map([
    ['SAME', schemeRecord(base, { publishStatus: 'published' })],
    ['NOW-SAME', schemeRecord({ ...base, code: 'NOW-SAME' }, { publishStatus: 'published' })],
    ['NOTES', schemeRecord({ ...base, code: 'NOTES' }, { publishStatus: 'published' })],
    ['FULL', schemeRecord({ ...base, code: 'FULL', name: 'Old' }, { publishStatus: 'published' })],
  ]);
  const writes: { code: unknown; sql: string }[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM scheme_imports'))
        return {
          rows: [
            {
              status: 'pending',
              preview: [
                {
                  rowId: 1,
                  sheetName: '方案',
                  rowNumber: 2,
                  code: 'SAME',
                  name: 'Scheme',
                  status: 'unchanged',
                  data: base,
                  snapshotRevision: 7,
                },
                {
                  rowId: 2,
                  sheetName: '方案',
                  rowNumber: 3,
                  code: 'NOW-SAME',
                  name: 'Scheme',
                  status: 'duplicate',
                  data: { ...base, code: 'NOW-SAME' },
                  snapshotRevision: 7,
                },
                {
                  rowId: 3,
                  sheetName: '方案',
                  rowNumber: 4,
                  code: 'NOTES',
                  name: 'Scheme',
                  status: 'duplicate',
                  data: { ...base, code: 'NOTES', notes: '新备注' },
                  snapshotRevision: 7,
                },
                {
                  rowId: 4,
                  sheetName: '方案',
                  rowNumber: 5,
                  code: 'FULL',
                  name: 'Scheme',
                  status: 'duplicate',
                  data: { ...base, code: 'FULL' },
                  snapshotRevision: 7,
                },
              ],
            },
          ],
        };
      if (sql.includes('FROM schemes WHERE code = ANY')) return { rows: [current.get((params![0] as string[])[0]!)] };
      if (sql.includes('UPDATE schemes')) {
        writes.push({ code: params?.[0], sql });
        return { rowCount: 1, rows: [] };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;

  const result = await commitImport(pool, null, 'import-1', { duplicateStrategy: 'update' });
  assert.deepEqual(
    { created: result.created, updated: result.updated, unchanged: result.unchanged, failed: result.failed },
    { created: 0, updated: 2, unchanged: 2, failed: [] },
  );
  assert.deepEqual(
    writes.map(write => write.code),
    ['NOTES', 'FULL'],
  );
  assert.doesNotMatch(writes[0]!.sql, /revision = revision \+ 1|publish_status|verification_status/);
  assert.match(writes[1]!.sql, /revision = revision \+ 1/);
  assert.match(writes[1]!.sql, /publish_status = CASE WHEN publish_status = 'published' THEN 'draft'/);
});
