import assert from 'node:assert/strict';
import test from 'node:test';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { createScheme, updateScheme } from '../src/modules/schemes/service.js';
import { commitImport } from '../src/modules/schemes/imports/commit.js';
import { validateSchemeDictionaryIds } from '../src/modules/schemes/dictionary-ids.js';

const adminId = '00000000-0000-4000-8000-000000000001';

test('draft CRUD rejects publication and verification supplied by clients', async () => {
  const pool = { query: async () => { throw new Error('request must be rejected before database access'); } } as unknown as pg.Pool;
  await assert.rejects(createScheme(pool, adminId, { code: 'S-1', name: 'test', publishStatus: 'published' } as never), { statusCode: 400 });
  await assert.rejects(updateScheme(pool, 'S-1', adminId, { verificationStatus: 'verified' } as never, 1), { statusCode: 400 });
});

test('scheme dictionary IDs must exist under the correct enabled dictionary', async () => {
  const id1 = '00000000-0000-4000-8000-000000000001';
  const id2 = '00000000-0000-4000-8000-000000000002';
  const pool = { query: async (_sql: string, values: unknown[]) => ({ rows: values[1] === 'industry' ? [{ id: id1 }] : [] }) } as unknown as pg.Pool;
  await validateSchemeDictionaryIds(pool, { industryIds: [id1] });
  await assert.rejects(validateSchemeDictionaryIds(pool, { industryIds: [id1, id2] }), { statusCode: 400 });
  await assert.rejects(validateSchemeDictionaryIds(pool, { productSystemId: id1 }), { statusCode: 400 });
});

test('scheme CRUD rejects fractional millimeters and conflicting area before writes', async () => {
  const pool = { query: async () => { throw new Error('must not access database'); } } as unknown as pg.Pool;
  await assert.rejects(createScheme(pool, adminId, { code: 'S', name: 'test', lengthMm: 1000.5 }), { statusCode: 400 });
});

test('draft route schema excludes publication and verification writes', async () => {
  const { default: Fastify } = await import('fastify');
  const { registerAdminSchemesRoutes } = await import('../src/http/admin/schemes/index.js');
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await registerAdminSchemesRoutes(app, { query: async () => { throw new Error('must not access database'); } } as unknown as pg.Pool, {} as Redis);
  try {
    const response = await app.inject({ method: 'POST', url: '/schemes', payload: { code: 'S-1', name: 'test', publishStatus: 'published' } });
    assert.equal(response.statusCode, 400);
    const removedConditions = await app.inject({ method: 'POST', url: '/schemes', payload: {
      code: 'S-2', name: 'test', applicableConditions: { status: 'confirmed', rules: [], labelsConfirmed: true, publicNotes: '' },
    } });
    assert.equal(removedConditions.statusCode, 400);
  } finally {
    await app.close();
  }
});

function publishedSchemeRow() {
  return {
    id: 'id', code: 'S-1', name: 'test', parentCode: null, lengthMm: 6000, widthMm: 3000, heightMm: 3500,
    areaM2: '18.000000', openingCount: 2, productSystemId: null, styleId: null, industryIds: [], budgetTierId: null,
    zoneIds: [], featureIds: [], description: null, keywords: null, source: null, visualTheme: null,
    publishStatus: 'published',
    verificationStatus: 'verified', notes: null, editRevision: 1, createdBy: null, updatedBy: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function updatePool(current: ReturnType<typeof publishedSchemeRow>) {
  const recorded = { updateSql: '', auditValues: undefined as unknown[] | undefined };
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('INSERT INTO dictionaries') || sql.includes('INSERT INTO dictionary_items')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM dictionary_items')) return { rows: [] };
      if (sql.includes('FROM schemes WHERE code = $1 FOR UPDATE')) return { rows: [current] };
      if (sql.includes('INSERT INTO admin_audit_logs')) { recorded.auditValues = values; return { rows: [] }; }
      if (sql.startsWith('UPDATE schemes SET')) {
        recorded.updateSql = sql;
        return { rows: [{ ...current, editRevision: sql.includes('revision = revision + 1') ? 2 : 1 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    connect: async () => ({ query: pool.query, release: () => {} }),
  } as unknown as pg.Pool;
  return { pool, recorded };
}

test('editing a published scheme atomically removes its publication and verification status', async () => {
  const { pool, recorded } = updatePool(publishedSchemeRow());
  await updateScheme(pool, 'S-1', adminId, { name: 'edited' }, 1);
  assert.match(recorded.updateSql, /revision = revision \+ 1/);
  assert.match(recorded.updateSql, /publish_status = CASE WHEN publish_status = 'published' THEN 'draft'/);
  assert.match(recorded.updateSql, /verification_status = 'unverified'/);
  assert.deepEqual(recorded.auditValues, [adminId, 'scheme.update', 'scheme', 'S-1', '{"revision":2,"fields":["name"]}']);
});

test('saving unchanged scheme fields keeps publication and revision without writing', async () => {
  const current = publishedSchemeRow();
  const { pool, recorded } = updatePool(current);
  const result = await updateScheme(pool, 'S-1', adminId, {
    name: 'test', lengthMm: 6000, widthMm: 3000, heightMm: 3500, areaM2: 18, openingCount: 2,
    industryIds: [], keywords: [], description: '',
  }, 1);
  assert.equal(recorded.updateSql, '');
  assert.equal(recorded.auditValues, undefined);
  assert.equal(result.editRevision, 1);
  assert.equal(result.publishStatus, 'published');
});

test('notes-only edit keeps publication and review revision', async () => {
  const { pool, recorded } = updatePool(publishedSchemeRow());
  const result = await updateScheme(pool, 'S-1', adminId, { name: 'test', notes: 'internal' }, 1);
  assert.match(recorded.updateSql, /notes = /);
  assert.doesNotMatch(recorded.updateSql, /revision = revision \+ 1|publish_status = |verification_status = /);
  assert.equal(result.editRevision, 1);
  assert.deepEqual(recorded.auditValues, [adminId, 'scheme.update', 'scheme', 'S-1', '{"revision":1,"fields":["notes"]}']);
});

test('stale revision is rejected before diffing scheme fields', async () => {
  const { pool } = updatePool(publishedSchemeRow());
  await assert.rejects(updateScheme(pool, 'S-1', adminId, { name: 'test' }, 0), { statusCode: 409 });
});

test('import update invalidates publication without trusting source verification claim', async () => {
  const sqls: string[] = [];
  const preview = [{ rowId: 1, sheetName: '方案', rowNumber: 2, code: 'S-1', name: 'imported', status: 'duplicate', snapshotRevision: 1, data: {
    code: 'S-1', name: 'imported', parentCode: null, widthMm: 3000, lengthMm: 6000,
    areaM2: 18, heightMm: 3500, openingCount: 2, productSystemId: null, styleId: null,
    industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], description: null,
    keywords: [], verificationStatus: 'verified', notes: null,
  } }];
  const query = async (sql: string, params?: unknown[]) => {
    sqls.push(sql);
    if (sql.includes('SELECT preview')) return { rows: [{ preview, status: 'pending' }] };
    if (sql.includes('FROM schemes WHERE code = ANY')) return { rows: [{ ...publishedSchemeRow(), code: 'S-1', editRevision: 1 }] };
    if (sql.includes('UPDATE schemes SET')) {
      assert.equal(params?.[16], null);
      assert.equal(params?.length, 19);
      return { rows: [{ id: 'scheme-id' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };
  const pool = { connect: async () => ({ query, release: () => {} }) } as unknown as pg.Pool;
  const result = await commitImport(pool, null, 'import-id', { duplicateStrategy: 'update' });
  assert.equal(result.updated, 1);
  const update = sqls.find(sql => sql.includes('UPDATE schemes SET'));
  assert.match(update ?? '', /verification_status = 'unverified'/);
  assert.match(update ?? '', /publish_status = CASE WHEN publish_status = 'published' THEN 'draft'/);
});
