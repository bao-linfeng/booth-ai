import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

const csPermissions = ['customer-service.read', 'customer-service.reply', 'customer-service.settings', 'customer-service.supervise'];

async function migrations(): Promise<string[]> {
  return (await readdir(new URL('../../migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
}

test('075 creates customer service tables, cs_translation purpose and grants permissions only to ROLE_ADMIN',
  { skip: !process.env.CS_TEST_DATABASE_URL }, async t => {
    const schema = `cs_migration_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.CS_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.CS_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });

    const files = await migrations();
    const index = files.indexOf('075_customer_service.sql');
    assert.ok(index > 0);
    for (const name of files.slice(0, index)) await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    await pool.query("INSERT INTO admin_roles(id,name,permission_codes,revision) VALUES(901,'ROLE_SUPPORT',ARRAY['projects.read'],3)");
    const before = (await pool.query("SELECT name, revision FROM admin_roles WHERE name IN ('ROLE_ADMIN','ROLE_SUPPORT') ORDER BY name")).rows;
    const sql = await readFile(new URL('../../migrations/075_customer_service.sql', import.meta.url), 'utf8');
    await pool.query(sql);
    for (const name of files.slice(index + 1)) await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));

    const roles = (await pool.query("SELECT name, revision, permission_codes FROM admin_roles WHERE name IN ('ROLE_ADMIN','ROLE_SUPPORT') ORDER BY name")).rows;
    assert.equal(roles[0].name, 'ROLE_ADMIN');
    for (const code of csPermissions) assert.ok(roles[0].permission_codes.includes(code), code);
    assert.equal(roles[0].revision, before[0].revision + 1);
    assert.deepEqual(roles[1].permission_codes, ['projects.read']);
    assert.equal(roles[1].revision, before[1].revision);

    const user = (await pool.query("INSERT INTO users(external_user_id,username,email) VALUES(1,'cs-user','cs@example.com') RETURNING id")).rows[0].id as string;
    const visitor = (await pool.query("INSERT INTO cs_visitors(token_hash,locale) VALUES(repeat('a',64),'en') RETURNING id")).rows[0].id as string;
    await assert.rejects(pool.query("INSERT INTO cs_visitors(token_hash,locale) VALUES(repeat('b',64),'xx')"), /cs_locale/);

    const first = (await pool.query("INSERT INTO cs_conversations(customer_user_id,customer_locale) VALUES($1,'zh') RETURNING id, conversation_no", [user])).rows[0];
    assert.match(first.conversation_no, /^CS-\d{8}$/);
    await assert.rejects(pool.query("INSERT INTO cs_conversations(customer_user_id,customer_locale) VALUES($1,'zh')", [user]), /cs_conversations_user_open_idx/);
    await pool.query("UPDATE cs_conversations SET status='closed', closed_at=now(), close_reason='agent' WHERE id=$1", [first.id]);
    await pool.query("INSERT INTO cs_conversations(customer_user_id,customer_locale) VALUES($1,'zh')", [user]);

    await pool.query("INSERT INTO cs_conversations(visitor_id,customer_locale) VALUES($1,'en')", [visitor]);
    await assert.rejects(pool.query("INSERT INTO cs_conversations(visitor_id,customer_locale) VALUES($1,'en')", [visitor]), /cs_conversations_visitor_open_idx/);
    await assert.rejects(pool.query("INSERT INTO cs_conversations(customer_user_id,visitor_id,customer_locale) VALUES($1,$2,'en')", [user, visitor]), /check/);
    await assert.rejects(pool.query("INSERT INTO cs_conversations(customer_locale) VALUES('en')"), /check/);

    const provider = (await pool.query(`INSERT INTO ai_providers(name,protocol,base_url,credential_scope)
      VALUES('cs-test','openai','https://example.com/v1','cs-test') RETURNING id`)).rows[0].id as string;
    const model = (await pool.query(`INSERT INTO ai_models(provider_id,kind,model)
      VALUES($1,'text','cs-test-model') RETURNING id`, [provider])).rows[0].id as string;
    await assert.rejects(pool.query("INSERT INTO ai_model_assignments(purpose,model_id,position,unit_credits) VALUES('cs_translation',$1,1,5)", [model]), /ai_model_assignments_check/);
    await pool.query("INSERT INTO ai_model_assignments(purpose,model_id,position) VALUES('cs_translation',$1,1)", [model]);

    await pool.query(sql.slice(sql.indexOf('UPDATE admin_roles')));
    assert.equal((await pool.query("SELECT revision FROM admin_roles WHERE name='ROLE_ADMIN'")).rows[0].revision, roles[0].revision);
  });
