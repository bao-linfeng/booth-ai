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
