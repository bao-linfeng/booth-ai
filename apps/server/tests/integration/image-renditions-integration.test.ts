import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import sharp from 'sharp';
import { processPendingRenditions } from '../../src/modules/media/sweeper.js';

test(
  'rendition sweeper fills missing image renditions, retries failures and skips non-images',
  { skip: !process.env.ASSET_TEST_DATABASE_URL },
  async t => {
    const schema = `renditions_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.ASSET_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: process.env.ASSET_TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    for (const name of (await readdir(new URL('../../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n)).sort()) {
      await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const product = (
      await pool.query<{ id: string }>(
        "SELECT i.id FROM dictionary_items i JOIN dictionaries d ON d.id=i.dictionary_id WHERE d.code='product_system' AND d.enabled AND i.enabled LIMIT 1",
      )
    ).rows[0]!.id;
    const scheme = randomUUID();
    await pool.query(
      `INSERT INTO schemes(id,code,name,length_mm,width_mm,height_mm,area_sqm,opening_count,product_system_id,industry_ids,zone_ids,feature_ids)
     VALUES($1,'RENDITIONS','RENDITIONS',6000,6000,3000,36,2,$2,'{}','{}','{}')`,
      [scheme, product],
    );
    async function version(objectKey: string, mimeType: string) {
      const assetId = randomUUID();
      await pool.query("INSERT INTO scheme_assets(id,scheme_id,type,name) VALUES($1,$2,'rendering','image')", [assetId, scheme]);
      const id = randomUUID();
      await pool.query(
        `INSERT INTO asset_versions(id,asset_id,object_key,original_filename,mime_type,byte_size,checksum) VALUES($1,$2,$3,$3,$4,1,'x')`,
        [id, assetId, objectKey, mimeType],
      );
      return id;
    }
    const objects = new Map<string, Buffer>([
      [
        'good.png',
        await sharp({ create: { width: 1920, height: 1080, channels: 4, background: '#123456' } })
          .png()
          .toBuffer(),
      ],
      ['broken.png', Buffer.from('not an image')],
      ['plan.pdf', Buffer.from('%PDF-1.7')],
    ]);
    const storage = {
      async getBuffer(key: string) {
        const body = objects.get(key);
        if (!body) throw new Error('NoSuchKey');
        return body;
      },
      async putBuffer(key: string, body: Buffer | Uint8Array) {
        objects.set(key, Buffer.from(body));
      },
    };
    const warnings: unknown[] = [];
    const log = { warn: (entry: unknown) => void warnings.push(entry) };
    const good = await version('good.png', 'image/png');
    const broken = await version('broken.png', 'image/png');
    const pdf = await version('plan.pdf', 'application/pdf');

    assert.deepEqual(await processPendingRenditions(pool, storage, log), {
      generated: 1,
      failed: 1,
    });
    const rows = new Map(
      (
        await pool.query<{
          id: string;
          renditions: Record<string, { key: string; width: number }> | null;
          attempts: number;
        }>('SELECT id, renditions, rendition_attempts AS attempts FROM asset_versions')
      ).rows.map(row => [row.id, row]),
    );
    assert.equal(rows.get(good)!.renditions!.thumb!.width, 480);
    assert.equal(rows.get(good)!.renditions!.preview!.width, 1600);
    assert.ok(objects.has(rows.get(good)!.renditions!.preview!.key));
    assert.equal(rows.get(broken)!.renditions, null);
    assert.equal(rows.get(broken)!.attempts, 1);
    assert.equal(rows.get(pdf)!.attempts, 0);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(JSON.stringify(warnings), /not an image/);

    // 失败项 10 分钟内不重复领取；之后重试，累计 3 次后不再领取
    assert.deepEqual(await processPendingRenditions(pool, storage, log), {
      generated: 0,
      failed: 0,
    });
    for (const expected of [
      { generated: 0, failed: 1 },
      { generated: 0, failed: 1 },
      { generated: 0, failed: 0 },
    ]) {
      await pool.query("UPDATE asset_versions SET rendition_attempted_at = now() - interval '11 minutes' WHERE id = $1", [broken]);
      assert.deepEqual(await processPendingRenditions(pool, storage, log), expected);
    }
    assert.equal((await pool.query('SELECT rendition_attempts FROM asset_versions WHERE id = $1', [broken])).rows[0].rendition_attempts, 3);
  },
);
