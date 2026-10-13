import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import {
  getThemeGenerationSettings,
  themePipelineOptions,
  updateThemeGenerationSettings,
} from '../../src/modules/generation/theme/settings.js';

test(
  'theme generation settings: defaults, optimistic revision, normalized colour and audit trail',
  { skip: !process.env.THEME_TEST_DATABASE_URL },
  async t => {
    const schema = `theme_settings_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.THEME_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.THEME_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    for (const name of ['002_auth', '022_audit_log', '083_theme_generation_settings']) {
      await pool.query(await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), 'utf8'));
    }
    const admin = randomUUID();
    await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'settings',ARRAY['ROLE_ADMIN'])", [admin]);

    assert.deepEqual(await themePipelineOptions(pool), {
      sendMask: true,
      composite: false,
      backgroundMode: 'fill',
      backgroundColor: '#E8EAEE',
    });

    const input = { sendMask: false, composite: true, backgroundMode: 'transparent', backgroundColor: '#ffffff' } as const;
    const updated = await updateThemeGenerationSettings(pool, { ...input, expectedRevision: 1 }, admin);
    assert.equal(updated.revision, 2);
    assert.equal(updated.backgroundColor, '#FFFFFF');
    assert.deepEqual(await themePipelineOptions(pool), { ...input, backgroundColor: '#FFFFFF' });

    await assert.rejects(updateThemeGenerationSettings(pool, { ...input, expectedRevision: 1 }, admin), {
      statusCode: 409,
      reason: 'REVISION_CONFLICT',
    });
    await assert.rejects(
      pool.query("UPDATE theme_generation_settings SET background_mode = 'blur'"),
      /theme_generation_settings_background_mode_check/,
    );

    const audit = (
      await pool.query<{ action: string; detail: { before: { sendMask: boolean }; after: { sendMask: boolean } } }>(
        'SELECT action, detail FROM admin_audit_logs WHERE admin_id = $1',
        [admin],
      )
    ).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.action, 'theme_generation_settings.update');
    assert.equal(audit[0]?.detail.before.sendMask, true);
    assert.equal(audit[0]?.detail.after.sendMask, false);
    assert.equal((await getThemeGenerationSettings(pool)).revision, 2);
  },
);
