import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { registerAdminAssetsRoutes } from '../../src/http/admin/assets/index.js';
import { registerAdminBomRoutes } from '../../src/http/admin/bill-of-materials/index.js';
import { registerAdminReviewsRoutes } from '../../src/http/admin/reviews/index.js';
import { registerAdminSchemesRoutes } from '../../src/http/admin/schemes/index.js';
import type { createStorage } from '../../src/infra/storage.js';
import { contractApp } from '../helpers/http-app.js';

// Fastify 已解码路由参数，方案编号不得再解码一次（否则 A%41 会命中 AA，A%B 会被拒绝）
const codes = ['A%41', 'A%B', '100%', '方案 1', 'A/B'];
const paths = ['', '/readiness', '/assets', '/bill-of-materials'];

test('admin scheme routes pass the scheme code to queries exactly as Fastify decoded it', async () => {
  const seen: unknown[][] = [];
  const query = async (_sql: string, values: unknown[] = []) => {
    seen.push(values);
    throw new Error('stop after first query');
  };
  const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as pg.Pool;
  const storage = {} as ReturnType<typeof createStorage>;
  const app = contractApp();
  await registerAdminSchemesRoutes(app, pool);
  await registerAdminReviewsRoutes(app, pool);
  await registerAdminAssetsRoutes(app, pool, storage);
  await registerAdminBomRoutes(app, pool, storage);
  try {
    for (const code of codes) {
      for (const path of paths) {
        seen.length = 0;
        const url = `/schemes/${encodeURIComponent(code)}${path}`;
        const response = await app.inject({ method: 'GET', url });
        assert.equal(response.statusCode, 500, url);
        assert.ok(
          seen.some(values => values.includes(code)),
          `${url} should query ${JSON.stringify(code)}, got ${JSON.stringify(seen)}`,
        );
        assert.ok(!seen.some(values => values.includes('AA')), `${url} must not double-decode`);
      }
    }
  } finally {
    await app.close();
  }
});
