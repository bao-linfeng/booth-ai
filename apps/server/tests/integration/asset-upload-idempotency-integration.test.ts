import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { listSchemeAssets } from '../../src/modules/assets/queries.js';
import { uploadAsset, type AssetUploadFile } from '../../src/modules/assets/upload.js';

test(
  'asset upload idempotency keys replay the first result instead of creating duplicates',
  {
    skip: !process.env.ASSET_TEST_DATABASE_URL,
  },
  async t => {
    const schema = `asset_upload_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.ASSET_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.ASSET_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    for (const name of (await readdir(new URL('../../migrations/', import.meta.url))).filter(n => /^\d+_.+\.sql$/.test(n)).sort()) {
      await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const admin = randomUUID();
    const code = 'UPLOAD-KEY';
    await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'test',ARRAY['ROLE_ADMIN'])", [admin]);
    await pool.query('INSERT INTO schemes(code,name) VALUES($1,$1)', [code]);

    const objects = new Map<string, number>();
    let puts = 0;
    const storage = {
      async putBuffer(key: string, body: Buffer | Uint8Array) {
        puts += 1;
        objects.set(key, body.length);
      },
      async deleteObject(key: string) {
        objects.delete(key);
      },
    };
    const file = (content: string): AssetUploadFile => ({
      buffer: Buffer.from(content),
      originalFilename: 'model.skp',
      mimeType: 'application/octet-stream',
    });
    const input = { schemeCode: code, type: 'model' as const, name: '模型' };
    const models = async () => (await listSchemeAssets(pool, code, 'model')).map(asset => asset.id);

    await t.test('a retried upload with the same key returns the first asset without storing again', async () => {
      const key = randomUUID();
      const first = await uploadAsset(pool, storage, admin, input, file('v1'), key);
      const retried = await uploadAsset(pool, storage, admin, input, file('v1'), key);
      assert.deepEqual(retried, first);
      assert.deepEqual(await models(), [first.id]);
      assert.equal(puts, 1);
    });

    await t.test('the same key with different content is rejected and writes nothing', async () => {
      const key = randomUUID();
      await uploadAsset(pool, storage, admin, input, file('v2'), key);
      const before = await models();
      await assert.rejects(uploadAsset(pool, storage, admin, input, file('changed'), key), {
        statusCode: 409,
        reason: 'UPLOAD_KEY_CONFLICT',
      });
      await assert.rejects(uploadAsset(pool, storage, admin, { ...input, name: '改名' }, file('v2'), key), {
        statusCode: 409,
        reason: 'UPLOAD_KEY_CONFLICT',
      });
      assert.deepEqual(await models(), before);
    });

    await t.test('intentionally uploading the same file again with a new key or without a key creates new assets', async () => {
      const before = (await models()).length;
      await uploadAsset(pool, storage, admin, input, file('v1'), randomUUID());
      await uploadAsset(pool, storage, admin, input, file('v1'));
      assert.equal((await models()).length, before + 2);
    });

    await t.test('concurrent retries create one asset and clean up the losing object', async () => {
      const key = randomUUID();
      const before = (await models()).length;
      const objectsBefore = objects.size;
      const results = await Promise.all([1, 2, 3].map(() => uploadAsset(pool, storage, admin, input, file('race'), key)));
      assert.equal(new Set(results.map(asset => asset.id)).size, 1);
      assert.equal((await models()).length, before + 1);
      assert.equal(objects.size, objectsBefore + 1);
    });

    await t.test('a key whose asset was deleted is not replayed', async () => {
      const key = randomUUID();
      const created = await uploadAsset(pool, storage, admin, input, file('deleted'), key);
      await pool.query('UPDATE scheme_assets SET is_active=false WHERE id=$1', [created.id]);
      await assert.rejects(uploadAsset(pool, storage, admin, input, file('deleted'), key), {
        statusCode: 409,
        reason: 'UPLOAD_KEY_CONFLICT',
      });
    });
  },
);
