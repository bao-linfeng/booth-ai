import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { createScheme, updateScheme } from '../src/modules/admin/schemes/service.js';
import { commitImport } from '../src/modules/admin/scheme-imports/service.js';

test('draft CRUD rejects publication and verification supplied by clients', async () => {
  const pool = { query: async () => { throw new Error('request must be rejected before database access'); } } as unknown as pg.Pool;
  await assert.rejects(createScheme(pool, null, { code: 'S-1', name: 'test', publishStatus: 'published' } as never), { statusCode: 400 });
  await assert.rejects(updateScheme(pool, 'S-1', null, { verificationStatus: 'verified' } as never, 1), { statusCode: 400 });
});

test('draft route schema excludes publication and verification writes', async () => {
  const { default: Fastify } = await import('fastify');
  const { registerAdminSchemesRoutes } = await import('../src/modules/admin/schemes/index.js');
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await registerAdminSchemesRoutes(app, { query: async () => { throw new Error('must not access database'); } } as unknown as pg.Pool);
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
  const pool = {
    query: async (sql: string) => {
      if (sql.startsWith('UPDATE schemes SET')) {
        updateSql = sql;
        return { rows: [{ id: 'id', code: 'S-1', name: 'test', revision: 2, createdAt: new Date(), updatedAt: new Date() }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as pg.Pool;
  await updateScheme(pool, 'S-1', null, { name: 'edited' }, 1);
  assert.match(updateSql, /publish_status = CASE WHEN publish_status = 'published' THEN 'draft'/);
  assert.match(updateSql, /verification_status = 'unverified'/);
});

test('import update invalidates publication without trusting source verification claim', async () => {
  const sqls: string[] = [];
  const preview = [{ rowNumber: 2, code: 'S-1', name: 'imported', status: 'duplicate', data: {
    code: 'S-1', name: 'imported', parentCode: null, widthCm: 300, lengthCm: 600,
    areaSqm: 18, heightCm: 350, openingCount: 2, productLine: 'island', style: null,
    industries: [], budgetTier: null, functionalZones: [], keyFeatures: [], description: null,
    keywords: [], verificationStatus: 'verified', notes: null,
  } }];
  const query = async (sql: string, params?: unknown[]) => {
    sqls.push(sql);
    if (sql.includes('SELECT preview')) return { rows: [{ preview }] };
    if (sql.includes('UPDATE schemes SET')) {
      assert.equal(params?.[16], null);
      assert.equal(params?.length, 18);
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
