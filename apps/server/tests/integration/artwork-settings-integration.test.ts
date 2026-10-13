import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { getAdminRole } from '../../src/modules/identity/roles.js';
import {
  artworkPipelineOptions,
  getArtworkGenerationSettings,
  updateArtworkGenerationSettings,
} from '../../src/modules/generation/artwork/settings.js';
import { loadDrawingCandidates } from '../../src/modules/generation/artwork/drawings.js';

test(
  '084 splits side drawings into left views, grants drawing updates and stores artwork settings with revision and audit',
  { skip: !process.env.ARTWORK_TEST_DATABASE_URL },
  async t => {
    const schema = `artwork_settings_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.ARTWORK_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.ARTWORK_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    const migrations = (await readdir(new URL('../../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n)).sort();
    const run = async (names: string[]) => {
      for (const name of names) await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    };
    await run(migrations.filter(name => name < '084_'));

    const productSystem = (
      await pool.query<{ id: string }>(
        "SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='product_system' LIMIT 1",
      )
    ).rows[0]!.id;
    const scheme = randomUUID();
    await pool.query(
      `INSERT INTO schemes(id,code,name,publish_status,length_mm,width_mm,height_mm,area_sqm,opening_count,product_system_id,industry_ids,zone_ids,feature_ids)
      VALUES($1,'DRAWINGS','DRAWINGS','published',6000,6000,3000,36,2,$2,'{}','{}','{}')`,
      [scheme, productSystem],
    );
    async function addAsset(type: string, metadata: object, sortOrder: number, mimeType = 'image/png') {
      const id = randomUUID();
      await pool.query('INSERT INTO scheme_assets(id,scheme_id,type,name,sort_order,metadata) VALUES($1,$2,$3,$3,$4,$5)', [
        id,
        scheme,
        type,
        sortOrder,
        JSON.stringify(metadata),
      ]);
      await pool.query(
        "INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum,created_at) VALUES($1,$2,'old.png',$3,10,'old',now()-interval '1 day')",
        [id, `old/${id}`, mimeType],
      );
      await pool.query(
        "INSERT INTO asset_versions(asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,'new.png',$3,10,'new')",
        [id, `new/${id}`, mimeType],
      );
      return id;
    }
    const side = await addAsset('drawing', { viewCodes: ['side', 'top'], purpose: '施工' }, 2);
    const duplicate = await addAsset('drawing', { viewCodes: ['left', 'side'] }, 1);
    const untagged = await addAsset('drawing', {}, 0);
    const pdf = await addAsset('drawing', { viewCodes: ['front'] }, 3, 'application/pdf');
    const artwork = await addAsset('artwork', { viewCodes: ['side'] }, 0);
    const inactive = await addAsset('drawing', { viewCodes: ['top'] }, 4);
    await pool.query('UPDATE scheme_assets SET is_active=false WHERE id=$1', [inactive]);
    await pool.query(
      "INSERT INTO admin_roles(id,name,permission_codes,revision) VALUES(901,'ROLE_DRAWINGS',ARRAY['assets-drawings.read','assets-drawings.upload','schemes.read'],1),(902,'ROLE_VIEWER',ARRAY['assets-drawings.read','schemes.read'],1)",
    );

    await run(migrations.filter(name => name >= '084_'));
    const metadata = async (id: string) => (await pool.query('SELECT metadata FROM scheme_assets WHERE id=$1', [id])).rows[0].metadata;
    assert.deepEqual(await metadata(side), { viewCodes: ['left', 'top'], purpose: '施工' });
    assert.deepEqual(await metadata(duplicate), { viewCodes: ['left'] });
    assert.deepEqual(await metadata(untagged), {});
    assert.deepEqual(await metadata(artwork), { viewCodes: ['side'] });
    const granted = await getAdminRole(pool, 901);
    assert.ok(granted.permissionCodes.includes('assets-drawings.update'));
    assert.equal(granted.revision, 2);
    assert.deepEqual((await getAdminRole(pool, 902)).permissionCodes, ['assets-drawings.read', 'schemes.read']);

    // 候选按排序取最新版本，跳过 PDF 与已删除的报馆图
    const candidates = await loadDrawingCandidates(pool, 'DRAWINGS');
    assert.deepEqual(
      candidates.map(c => [c.assetId, c.objectKey, c.viewCodes]),
      [
        [untagged, `new/${untagged}`, []],
        [duplicate, `new/${duplicate}`, ['left']],
        [side, `new/${side}`, ['left', 'top']],
      ],
    );
    assert.ok(!candidates.some(c => c.assetId === pdf));

    const admin = randomUUID();
    await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'settings',ARRAY['ROLE_ADMIN'])", [admin]);
    assert.deepEqual(await artworkPipelineOptions(pool), { drawingDirections: ['front', 'back', 'left', 'right'], drawingGrayscale: true });
    const updated = await updateArtworkGenerationSettings(
      pool,
      { drawingDirections: ['right', 'front', 'right'], drawingGrayscale: false, expectedRevision: 1 },
      admin,
    );
    assert.equal(updated.revision, 2);
    assert.deepEqual(await artworkPipelineOptions(pool), { drawingDirections: ['front', 'right'], drawingGrayscale: false });
    await assert.rejects(
      updateArtworkGenerationSettings(pool, { drawingDirections: [], drawingGrayscale: true, expectedRevision: 1 }, admin),
      { statusCode: 409, reason: 'REVISION_CONFLICT' },
    );
    await assert.rejects(
      pool.query("UPDATE artwork_generation_settings SET drawing_directions = ARRAY['top']"),
      /artwork_generation_settings_drawing_directions_check/,
    );
    const disabled = await updateArtworkGenerationSettings(
      pool,
      { drawingDirections: [], drawingGrayscale: true, expectedRevision: 2 },
      admin,
    );
    assert.deepEqual(disabled.drawingDirections, []);
    assert.equal((await getArtworkGenerationSettings(pool)).revision, 3);

    const audit = (
      await pool.query<{ action: string; detail: { before: { drawingDirections: string[] }; after: { drawingDirections: string[] } } }>(
        'SELECT action, detail FROM admin_audit_logs WHERE admin_id = $1 ORDER BY created_at, id',
        [admin],
      )
    ).rows;
    assert.deepEqual(
      audit.map(row => [row.action, row.detail.before.drawingDirections, row.detail.after.drawingDirections]),
      [
        ['artwork_generation_settings.update', ['front', 'back', 'left', 'right'], ['front', 'right']],
        ['artwork_generation_settings.update', ['front', 'right'], []],
      ],
    );
  },
);
