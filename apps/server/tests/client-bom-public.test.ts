import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type pg from 'pg';
import { registerClientBomRoutes } from '../src/http/client/bill-of-materials/index.js';

function createPool(published: boolean) {
  return { query: async (sql: string) => {
    if (sql.includes('SELECT 1 FROM schemes')) return { rows: published ? [{ exists: 1 }] : [] };
    if (sql.includes('FROM schemes WHERE code')) return { rows: [{ id: 'scheme-id' }] };
    if (sql.includes('FROM scheme_boms b')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as pg.Pool;
}

test('anonymous requests reach published BOM routes and unpublished schemes return 404', async t => {
  const app = Fastify();
  t.after(() => app.close());
  await registerClientBomRoutes(app, createPool(true));
  const list = await app.inject('/schemes/S-1/bill-of-materials');
  assert.equal(list.statusCode, 409);
  assert.equal(list.headers['cache-control'], 'no-store');
  const download = await app.inject('/schemes/S-1/bill-of-materials/download?revision=1');
  assert.equal(download.statusCode, 409);

  const unpublished = Fastify();
  t.after(() => unpublished.close());
  await registerClientBomRoutes(unpublished, createPool(false));
  assert.equal((await unpublished.inject('/schemes/S-1/bill-of-materials')).statusCode, 404);
  assert.equal((await unpublished.inject('/schemes/S-1/bill-of-materials/download?revision=1')).statusCode, 404);
});

test('verified BOM is returned in the { code, data } envelope without internal pricing', async t => {
  const item = {
    id: 'item-1', bomId: 'bom-1', ordinal: 1, productName: '型材', productModel: 'FS62', specificationMm: '992x2480',
    sourceQuantity: '1', sourceUnit: '件', measurementKind: 'count', quantity: '1.000000', erpCode: '123',
    unitPrice: '99.00', totalPrice: '99.00', totalWeightKg: '21.3', sourceSheet: 'Sheet1', sourceRow: 2, diffNote: null,
  };
  const pool = { query: async (sql: string) => {
    if (sql.includes('SELECT 1 FROM schemes')) return { rows: [{ exists: 1 }] };
    if (sql.includes('FROM schemes WHERE code')) return { rows: [{ id: 'scheme-id' }] };
    if (sql.includes('FROM scheme_boms b')) {
      return { rows: [{ id: 'bom-1', schemeId: 'scheme-id', revision: 2, status: 'verified', sourceAssetId: null, contentHash: 'h',
        verifiedAt: '2026-09-28T13:56:31.183Z', createdAt: '2026-09-28T13:00:00.000Z', updatedAt: '2026-09-28T13:56:31.183Z', items: [item] }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as pg.Pool;
  const app = Fastify();
  t.after(() => app.close());
  await registerClientBomRoutes(app, pool);

  const response = await app.inject('/schemes/S-1/bill-of-materials');
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.code, 0);
  assert.equal(body.data.schemeCode, 'S-1');
  assert.equal(body.data.revision, 2);
  assert.deepEqual(body.data.items, [{
    id: 'item-1', ordinal: 1, productName: '型材', productModel: 'FS62', specificationMm: '992x2480',
    quantity: '1.000000', sourceUnit: '件', erpCode: '123', totalWeightKg: '21.3', measurementKind: 'count',
  }]);
});
