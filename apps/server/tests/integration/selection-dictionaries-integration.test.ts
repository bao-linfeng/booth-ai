import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { createScheme, listSchemes, updateScheme } from '../../src/modules/schemes/service.js';
import { previewImport } from '../../src/modules/schemes/imports/preview.js';
import { commitImport } from '../../src/modules/schemes/imports/commit.js';
import { loadImportDictionaries, validateImportRow } from '../../src/modules/schemes/imports/validation.js';
import { parseWorkbook } from '../../src/modules/schemes/imports/workbook.js';
import { createDictionaryItem, deleteDictionaryItem, updateDictionaryItem } from '../../src/modules/dictionaries/service.js';
import { loadCatalog } from '../../src/modules/selection/repository.js';

test(
  'size migration, Excel import, transactional CRUD and dictionary language persistence against PostgreSQL',
  {
    skip: !process.env.SELECTION_TEST_DATABASE_URL,
  },
  async t => {
    const schema = `selection_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.SELECTION_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.SELECTION_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    const names = (await readdir(new URL('../../migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    for (const name of names.filter(name => name < '062'))
      await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    await pool.query(`INSERT INTO schemes(code,name,length_mm,width_mm,height_mm,area_sqm)
    VALUES ('LEGACY-1','旧方案',6000,3000,4500,18),('LEGACY-2','旧方案',6000,3000,4500,18),('LEGACY-3','旧方案',6000,3000,4000,18)`);
    await pool.query(`INSERT INTO dictionary_items(dictionary_id,item_value,item_label)
    SELECT id,'6000','6 m' FROM dictionaries WHERE code='booth_length'`);
    for (const name of names.filter(name => name >= '062' && name < '064'))
      await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    await pool.query("INSERT INTO schemes(code,name,length_mm,width_mm,height_mm,area_sqm) VALUES ('IMPORTED','旧导入',3000,6000,4500,18)");
    await pool.query(
      `INSERT INTO scheme_imports(source_filename,status,preview,committed_at,expires_at)
    VALUES ('灵通展台方案打标模板.xlsx','committed',$1,now(),now()+interval '1 hour')`,
      [JSON.stringify([{ code: 'IMPORTED', status: 'valid', data: { lengthMm: 3000, widthMm: 6000, heightMm: 4500 } }])],
    );
    for (const name of names.filter(name => name >= '064'))
      await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual((await pool.query("SELECT length_mm,width_mm FROM schemes WHERE code='IMPORTED'")).rows[0], {
      length_mm: 6000,
      width_mm: 3000,
    });
    const sizeValues = async () =>
      (
        await pool.query<{ value: string }>(`SELECT i.item_value AS value FROM dictionary_items i
    JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='booth_size' ORDER BY i.item_value`)
      ).rows.map(row => row.value);
    assert.deepEqual(await sizeValues(), ['6000-3000-4000', '6000-3000-4500']);
    assert.equal(
      (await pool.query("SELECT count(*) FROM dictionaries WHERE code IN ('booth_length','booth_width','booth_height','booth_area')"))
        .rows[0].count,
      '0',
    );
    assert.ok((await pool.query('SELECT * FROM retired_size_dictionary_backup')).rowCount);

    const adminId = randomUUID();
    await pool.query("INSERT INTO admins(id,external_user_id,username) VALUES($1,1,'test')", [adminId]);
    const buffer = await readFile(new URL('../../../../docs/source/灵通展台方案打标模板.xlsx', import.meta.url));
    const preview = await previewImport(pool, adminId, buffer, 'template.xlsx');
    assert.equal(preview.summary.valid, 48);
    const imported = await commitImport(pool, adminId, preview.importId, { duplicateStrategy: 'skip' });
    assert.equal(imported.created, 48);
    assert.deepEqual(imported.failed, []);
    assert.equal((await sizeValues()).length, 5);
    assert.deepEqual(await commitImport(pool, adminId, preview.importId, { duplicateStrategy: 'skip' }), imported);
    const repeated = await previewImport(pool, adminId, buffer, 'template.xlsx');
    assert.deepEqual([repeated.summary.duplicate, repeated.summary.unchanged, repeated.summary.unpublish], [0, 48, 0]);
    assert.equal((await commitImport(pool, adminId, repeated.importId, { duplicateStrategy: 'skip' })).dictionaryItemsCreated, 0);
    // 内容一致的覆盖不写入；仅备注变化时写入备注但不递增修订、不下架
    const sample = repeated.rows[0]!.code;
    await pool.query("UPDATE schemes SET publish_status='published', notes='内部备注' WHERE code=$1", [sample]);
    const revisions = async () =>
      (await pool.query<{ code: string; revision: number }>('SELECT code, revision FROM schemes ORDER BY code')).rows;
    const beforeOverwrite = await revisions();
    const overwrite = await previewImport(pool, adminId, buffer, 'template.xlsx');
    assert.deepEqual([overwrite.summary.duplicate, overwrite.summary.unchanged, overwrite.summary.unpublish], [1, 47, 0]);
    assert.deepEqual(overwrite.rows.find(row => row.code === sample)?.clearedFields, ['notes']);
    const overwritten = await commitImport(pool, adminId, overwrite.importId, { duplicateStrategy: 'update' });
    assert.deepEqual([overwritten.updated, overwritten.unchanged, overwritten.failed.length], [1, 47, 0]);
    assert.deepEqual(await revisions(), beforeOverwrite);
    assert.deepEqual((await pool.query('SELECT publish_status, notes FROM schemes WHERE code=$1', [sample])).rows[0], {
      publish_status: 'published',
      notes: null,
    });

    const manual = await createScheme(pool, adminId, {
      code: 'MANUAL',
      name: '手动新增',
      lengthMm: 3000,
      widthMm: 6000,
      heightMm: 4200,
      openingCount: 2,
    });
    assert.ok((await sizeValues()).includes('3000-6000-4200'));
    const keywordCodes = async (keyword: string) =>
      (await listSchemes(pool, { page: 1, pageSize: 100, keyword })).data.map(item => item.code).filter(code => code === 'MANUAL');
    assert.deepEqual(await keywordCodes('manu'), ['MANUAL']);
    assert.deepEqual(await keywordCodes('手动'), ['MANUAL']);
    assert.deepEqual(await keywordCodes('n_a'), []);
    const edited = await updateScheme(pool, manual.code, adminId, { heightMm: 4300 }, manual.editRevision);
    assert.equal(edited.heightMm, 4300);
    assert.ok((await sizeValues()).includes('3000-6000-4300'));
    const before = await sizeValues();
    await assert.rejects(updateScheme(pool, manual.code, adminId, { heightMm: 4900 }, manual.editRevision), { statusCode: 409 });
    assert.deepEqual(await sizeValues(), before);
    const unchanged = await updateScheme(
      pool,
      manual.code,
      adminId,
      {
        name: '手动新增',
        lengthMm: 3000,
        widthMm: 6000,
        heightMm: 4300,
        areaM2: 18,
        openingCount: 2,
        industryIds: [],
        description: '',
      },
      edited.editRevision,
    );
    assert.equal(unchanged.editRevision, edited.editRevision);
    const notesEdited = await updateScheme(pool, manual.code, adminId, { notes: '内部备注' }, edited.editRevision);
    assert.equal(notesEdited.notes, '内部备注');
    assert.equal(notesEdited.editRevision, edited.editRevision);
    const referencedSize = (await pool.query<{ id: string }>("SELECT id FROM dictionary_items WHERE item_value='3000-6000-4300'")).rows[0]!;
    await assert.rejects(deleteDictionaryItem(pool, referencedSize.id), { statusCode: 409 });

    const modern = (
      await pool.query<{ id: string; dictionaryId: string }>(`SELECT i.id,d.id AS "dictionaryId" FROM dictionary_items i
    JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='style' AND i.item_value='modern'`)
    ).rows[0]!;
    const updated = await updateDictionaryItem(
      pool,
      modern.id,
      {
        labels: { en: 'Modern minimalist', ja: 'モダン・ミニマル' },
        aliases: [
          { locale: 'en', text: 'simple modern' },
          { locale: 'ja', text: 'シンプルモダン' },
        ],
      },
      modern.dictionaryId,
    );
    assert.equal(updated.labels.ja, 'モダン・ミニマル');
    const source = (await parseWorkbook(buffer)).find(row => row.data.code)!.data;
    for (const style of ['现代简约', 'MODERN MINIMALIST', 'モダン・ミニマル', 'ＳＩＭＰＬＥ ＭＯＤＥＲＮ', 'シンプルモダン']) {
      assert.equal(validateImportRow(await loadImportDictionaries(pool), { ...source, styleId: style }).styleId, modern.id);
    }
    const duplicate = await createDictionaryItem(pool, modern.dictionaryId, {
      itemValue: 'ambiguous',
      itemLabel: '其他风格',
      aliases: [{ locale: 'en', text: 'simple modern' }],
    });
    const dictionaries = await loadImportDictionaries(pool);
    assert.throws(() => validateImportRow(dictionaries, { ...source, styleId: 'simple modern' }), { statusCode: 400 });
    await updateDictionaryItem(pool, duplicate.id, { enabled: false }, modern.dictionaryId);
    assert.equal(validateImportRow(await loadImportDictionaries(pool), { ...source, styleId: 'simple modern' }).styleId, modern.id);

    const sizeId = (await pool.query<{ id: string }>("SELECT id FROM dictionary_items WHERE item_value='6000-3000-4500'")).rows[0]!.id;
    assert.equal((await loadCatalog(pool)).boothSpaces.length, 0);
    const schemeId = (await pool.query<{ id: string }>("UPDATE schemes SET publish_status='published' WHERE code='LEGACY-1' RETURNING id"))
      .rows[0]!.id;
    await pool.query("INSERT INTO scheme_reviews(scheme_id,request_key,scheme_revision,phase,decision) VALUES($1,$2,1,'overall','pass')", [
      schemeId,
      randomUUID(),
    ]);
    const chinese = await loadCatalog(pool, 'zh-CN');
    const english = await loadCatalog(pool, 'en-US');
    const japanese = await loadCatalog(pool, 'ja-JP');
    assert.equal(chinese.boothSpaces[0]?.id, sizeId);
    assert.equal(english.styles.find(item => item.id === modern.id)?.label, 'Modern minimalist');
    assert.equal(japanese.styles.find(item => item.id === modern.id)?.label, 'モダン・ミニマル');
    assert.equal(chinese.dictionaryVersion, japanese.dictionaryVersion);
  },
);

test(
  'Excel import fills emptied selection dictionaries automatically against PostgreSQL',
  {
    skip: !process.env.SELECTION_TEST_DATABASE_URL,
  },
  async t => {
    const schema = `selection_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.SELECTION_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.SELECTION_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    const names = (await readdir(new URL('../../migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    for (const name of names) await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    const codes = ['product_system', 'style', 'industry', 'budget_tier', 'functional_zone', 'key_feature'];
    await pool.query('DELETE FROM dictionary_items i USING dictionaries d WHERE d.id = i.dictionary_id AND d.code = ANY($1::text[])', [
      codes,
    ]);
    const adminId = randomUUID();
    await pool.query("INSERT INTO admins(id,external_user_id,username) VALUES($1,1,'test')", [adminId]);
    const buffer = await readFile(new URL('../../../../docs/source/灵通展台方案打标模板.xlsx', import.meta.url));

    const preview = await previewImport(pool, adminId, buffer, 'template.xlsx');
    assert.equal(preview.summary.valid, 48);
    assert.ok(preview.rows.every(row => row.newDictionaryLabels?.productSystemId?.[0] === 'FS62布框'));
    const imported = await commitImport(pool, adminId, preview.importId, { duplicateStrategy: 'skip' });
    assert.deepEqual([imported.created, imported.failed], [48, []]);

    const itemCounts = async () =>
      Object.fromEntries(
        (
          await pool.query<{ code: string; count: number }>(
            `SELECT d.code, count(i.id)::int AS count FROM dictionaries d LEFT JOIN dictionary_items i ON i.dictionary_id = d.id
            WHERE d.code = ANY($1::text[]) GROUP BY d.code`,
            [codes],
          )
        ).rows.map(row => [row.code, row.count]),
      );
    const expected = { product_system: 1, style: 7, industry: 9, budget_tier: 2, functional_zone: 6, key_feature: 10 };
    assert.deepEqual(await itemCounts(), expected);
    assert.ok(imported.dictionaryItemsCreated >= 35);
    const unreferenced = await pool.query(
      `SELECT i.item_label FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id
      WHERE d.code = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM schemes s WHERE s.product_system_id = i.id OR s.style_id = i.id
        OR s.budget_tier_id = i.id OR i.id = ANY(s.industry_ids) OR i.id = ANY(s.zone_ids) OR i.id = ANY(s.feature_ids))`,
      [codes],
    );
    assert.deepEqual(unreferenced.rows, []);
    const first = preview.rows[0]!;
    const stored = await pool.query<{ style: string; zones: string[] }>(
      `SELECT st.item_label AS style, ARRAY(SELECT z.item_label FROM unnest(s.zone_ids) WITH ORDINALITY u(id, n)
        JOIN dictionary_items z ON z.id = u.id ORDER BY u.n) AS zones
      FROM schemes s JOIN dictionary_items st ON st.id = s.style_id WHERE s.code = $1`,
      [first.code],
    );
    assert.deepEqual(stored.rows[0], { style: first.dictionaryLabels!.styleId![0], zones: first.dictionaryLabels!.zoneIds });

    const repeated = await previewImport(pool, adminId, buffer, 'template.xlsx');
    assert.equal(repeated.summary.unchanged, 48);
    assert.ok(repeated.rows.every(row => row.newDictionaryLabels === undefined));
    assert.equal((await commitImport(pool, adminId, repeated.importId, { duplicateStrategy: 'skip' })).dictionaryItemsCreated, 0);
    assert.deepEqual(await itemCounts(), expected);
  },
);
