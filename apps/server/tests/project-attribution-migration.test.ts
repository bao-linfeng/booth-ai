import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

test('077 removes project attribution and cleans historical assignment receipts while preserving project data',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL }, async t => {
    const schema = `project_migration_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
    const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    const index = files.indexOf('077_drop_project_attribution.sql');
    assert.ok(index > 0);
    for (const name of files.slice(0, index)) await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    const admin = (await pool.query("INSERT INTO admins(external_user_id,username) VALUES(1,'migration-admin') RETURNING id")).rows[0].id as string;
    const project = (await pool.query(`INSERT INTO projects(request_no,source_type,assignee_admin_id,request_snapshot,attribution)
      VALUES('MR-MIGRATION','manual_request',$1,'{"contact":{"name":"客户"}}','{"type":"public"}') RETURNING *`, [admin])).rows[0];
    const receipt = { projectId: project.id, revision: 2, assigneeAdminId: admin };
    await pool.query(`INSERT INTO project_operations(actor_type,actor_id,operation,target,request_key,payload_hash,receipt)
      VALUES('admin',$1,'assignee',$2,'assignment-key','hash',$3)`, [admin, project.id, JSON.stringify({ ...receipt, attribution: { type: 'public' } })]);
    const event = (await pool.query(`INSERT INTO project_events(project_id,kind,payload)
      VALUES($1,'assignment',$2) RETURNING *`, [project.id, JSON.stringify({ assigneeAdminId: admin, reason: '改派' })])).rows[0];
    await pool.query(await readFile(new URL(`../migrations/${files[index]}`, import.meta.url), 'utf8'));
    const columns = (await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='projects' AND column_name='attribution'`)).rows;
    assert.equal(columns.length, 0);
    const { attribution: removed, ...expected } = project;
    assert.deepEqual(removed, { type: 'public' });
    assert.deepEqual((await pool.query('SELECT * FROM projects WHERE id=$1', [project.id])).rows[0], expected);
    assert.deepEqual((await pool.query("SELECT receipt FROM project_operations WHERE request_key='assignment-key'")).rows[0].receipt, receipt);
    assert.deepEqual((await pool.query('SELECT * FROM project_events WHERE id=$1', [event.id])).rows[0], event);
  });
