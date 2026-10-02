import assert from 'node:assert/strict';
import test from 'node:test';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { createScheme, updateScheme } from '../src/modules/schemes/service.js';
import { commitImport } from '../src/modules/schemes/imports.js';
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
    const invalidConditions = await app.inject({ method: 'POST', url: '/schemes', payload: {
      code: 'S-2', name: 'test', applicableConditions: { status: 'confirmed', rules: [], labelsConfirmed: true, publicNotes: '', arbitrary: true },
    } });
    assert.equal(invalidConditions.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('editing a published scheme atomically removes its publication and verification status', async () => {
  let updateSql = '';
  let auditValues: unknown[] | undefined;
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM dictionary_items')) return { rows: [] };
      if (sql.includes('INSERT INTO admin_audit_logs')) { auditValues = values; return { rows: [] }; }
      if (sql.startsWith('UPDATE schemes SET')) {
        updateSql = sql;
        return { rows: [{ id: 'id', code: 'S-1', name: 'test', revision: 2, createdAt: new Date(), updatedAt: new Date() }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;
  await updateScheme(pool, 'S-1', adminId, { name: 'edited' }, 1);
  assert.match(updateSql, /publish_status = CASE WHEN publish_status = 'published' THEN 'draft'/);
  assert.match(updateSql, /verification_status = 'unverified'/);
  assert.deepEqual(auditValues, [adminId, 'scheme.update', 'scheme', 'S-1', '{}']);
});

test('import update invalidates publication without trusting source verification claim', async () => {
  const sqls: string[] = [];
  const preview = [{ rowNumber: 2, code: 'S-1', name: 'imported', status: 'duplicate', snapshotRevision: 1, data: {
    code: 'S-1', name: 'imported', parentCode: null, widthMm: 3000, lengthMm: 6000,
    areaM2: 18, heightMm: 3500, openingCount: 2, productSystemId: null, styleId: null,
    industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], description: null,
    keywords: [], verificationStatus: 'verified', notes: null,
  } }];
  const query = async (sql: string, params?: unknown[]) => {
    sqls.push(sql);
    if (sql.includes('SELECT preview')) return { rows: [{ preview, status: 'pending' }] };
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
