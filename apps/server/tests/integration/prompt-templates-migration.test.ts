import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

test(
  'migration 045 extends prompt templates in an isolated schema without changing existing rows',
  { skip: !process.env.PROMPT_TEMPLATE_TEST_DATABASE_URL },
  async t => {
    const schema = `prompt_templates_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.PROMPT_TEMPLATE_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: process.env.PROMPT_TEMPLATE_TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });

    for (const name of ['002_auth', '009_dictionaries', '027_selection_analytics', '033_prompt_templates']) {
      await pool.query(await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), 'utf8'));
    }

    const admin = randomUUID();
    await pool.query('INSERT INTO admins(id,external_user_id,username) VALUES ($1,1,$2)', [admin, 'migration-admin']);
    const industry = randomUUID();
    const style = randomUUID();
    const dictionaryIds = new Map<string, string>();
    for (const code of ['industry', 'style']) {
      const dictionary = (await pool.query<{ id: string }>('INSERT INTO dictionaries(code,name) VALUES ($1,$1) RETURNING id', [code]))
        .rows[0]!.id;
      dictionaryIds.set(code, dictionary);
    }
    await pool.query('INSERT INTO dictionary_items(id,dictionary_id,item_value,item_label) VALUES ($1,$2,$3,$3),($4,$5,$6,$6)', [
      industry,
      dictionaryIds.get('industry'),
      'industry',
      style,
      dictionaryIds.get('style'),
      'style',
    ]);
    const existing = randomUUID();
    await pool.query(
      `INSERT INTO prompt_templates(id,purpose,body,variables,created_by,updated_by)
       VALUES ($1,'theme','{{industryLabel}}','{"industryLabel"}',$2,$2)`,
      [existing, admin],
    );
    const before = await pool.query('SELECT id,purpose,body,variables FROM prompt_templates WHERE id=$1', [existing]);

    await pool.query(await readFile(new URL('../../migrations/045_prompt_business_templates.sql', import.meta.url), 'utf8'));

    const after = await pool.query('SELECT id,purpose,body,variables FROM prompt_templates WHERE id=$1', [existing]);
    assert.deepEqual(after.rows, before.rows);
    const purposeCheck = await pool.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='prompt_templates_purpose_check' AND connamespace=current_schema()::regnamespace",
    );
    assert.match(purposeCheck.rows[0].definition, /filter/);
    const scopeCheck = await pool.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='prompt_templates_filter_scope_check' AND connamespace=current_schema()::regnamespace",
    );
    assert.match(scopeCheck.rows[0].definition, /filter/);

    const filterId = randomUUID();
    await pool.query(
      `INSERT INTO prompt_templates(id,purpose,body,variables,created_by,updated_by,enabled)
       VALUES ($1,'filter','解析用户需求','{}',$2,$2,true)`,
      [filterId, admin],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO prompt_templates(id,purpose,industry_id,body,variables,created_by,updated_by)
         VALUES ($1,'filter',$2,'解析用户需求','{}',$3,$3)`,
        [randomUUID(), industry, admin],
      ),
      error =>
        (error as { code?: string; constraint?: string }).code === '23514' &&
        (error as { constraint?: string }).constraint === 'prompt_templates_filter_scope_check',
    );
    await pool.query(
      `INSERT INTO prompt_templates(id,purpose,industry_id,style_id,body,variables,created_by,updated_by)
       VALUES ($1,'theme',$2,$3,'{{industryLabel}}','{"industryLabel"}',$4,$4)`,
      [randomUUID(), industry, style, admin],
    );

    const parse = randomUUID();
    const attempt = randomUUID();
    await pool.query(`INSERT INTO selection_attempts(id,visitor_id) VALUES ($1,'visitor')`, [attempt]);
    await pool.query(
      `INSERT INTO selection_parses(id,attempt_id,visitor_id,input_text,form_requirement,final_requirement,parser,degraded,
        field_sources,overrides,clarifications,unhandled_text,warnings,rules_version,dictionary_version,duration_ms,prompt_snapshot)
       VALUES ($1,$2,'visitor','text','{}','{}','llm',false,'{}','[]','[]',ARRAY[]::text[],'[]','rules','dict',1,$3)`,
      [parse, attempt, JSON.stringify({ source: 'template', templateId: filterId, revision: 1 })],
    );
    const snapshot = await pool.query<{ prompt_snapshot: { source: string; templateId: string } }>(
      'SELECT prompt_snapshot FROM selection_parses WHERE id=$1',
      [parse],
    );
    assert.deepEqual(snapshot.rows[0]!.prompt_snapshot, { source: 'template', templateId: filterId, revision: 1 });

    await assert.rejects(
      pool.query(
        `INSERT INTO prompt_templates(id,purpose,body,variables,created_by,updated_by,enabled)
         VALUES ($1,'filter','另一个解析模板','{}',$2,$2,true)`,
        [randomUUID(), admin],
      ),
      error =>
        (error as { code?: string; constraint?: string }).code === '23505' &&
        (error as { constraint?: string }).constraint === 'prompt_templates_active_unique',
    );
  },
);
