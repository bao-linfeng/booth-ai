import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createSession, encryptJwt } from '../../src/infra/session.js';
import { defaultUploadMaxBytes, workbookUploadMaxBytes } from '../../src/http/uploads.js';

const config = loadConfig({
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test',
  S3_ACCESS_KEY: 'test', S3_SECRET_KEY: 'test', CORS_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64), EXTERNAL_API_URL: 'https://api.example.test',
});
const healthy = { database: async () => {}, redis: async () => {}, storage: async () => {} };
const assetId = '00000000-0000-4000-8000-000000000002';
const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function multipartBody(fields: Record<string, string>, file: { filename: string; mimeType: string; size: number }): Buffer {
  return Buffer.concat([
    ...Object.entries(fields).map(([name, value]) => Buffer.from(`--limit-boundary\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)),
    Buffer.from(`--limit-boundary\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
    Buffer.alloc(file.size),
    Buffer.from('\r\n--limit-boundary--\r\n'),
  ]);
}

test('uploads at the limit reach the route while one extra byte is rejected with FILE_TOO_LARGE before any write', async t => {
  const businessQueries: string[] = [];
  const storageWrites: string[] = [];
  const pool = { query: async (sql: string) => {
    if (sql.includes('session_version')) return { rows: [{ enabled: true, roles: ['ROLE_TEST'], sessionVersion: 1 }] };
    if (sql.includes('unnest(permission_codes)')) {
      return { rows: ['schemes.import', 'bom.import', 'assets-models.read', 'assets-models.upload', 'assets-drawings.read', 'assets-drawings.replace'].map(code => ({ code })) };
    }
    if (sql.includes('sa.id = $2')) return { rows: [{ id: assetId, type: 'drawing', schemeCode: 'TEST', revision: 1, createdAt: new Date(), updatedAt: new Date(), versionId: null }] };
    businessQueries.push(sql);
    throw new Error('Rejected uploads must not reach business queries');
  }, connect: async () => { throw new Error('Rejected uploads must not open transactions'); } } as unknown as pg.Pool;
  const values = new Map<string, string>();
  const redis = { get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value); return 'OK'; }, del: async (key: string) => Number(values.delete(key)) } as unknown as Redis;
  const storage = { putBuffer: async (key: string) => { storageWrites.push(key); } };
  const token = await createSession(redis, { site: 'admin', localId: '00000000-0000-4000-8000-000000000001', externalUserId: 1, username: 'test',
    sessionVersion: 1, externalJwtCiphertext: encryptJwt('jwt', config.sessionSecret), loginSource: 'password' }, 3600, Math.floor(Date.now() / 1000) + 3600);
  const app = await buildApp(config, healthy, { pool, redis, storage } as never);
  t.after(() => app.close());

  // 边界值请求故意缺字段或文件头无效，确认完整文件已交给路由校验，且不触发存储与数据库写入。
  const cases = [
    { name: 'scheme import', url: '/api/v1/admin/scheme-imports', limit: workbookUploadMaxBytes, fields: {}, filename: 'schemes.xlsx', mimeType: xlsxMime, atLimit: 'not-413' },
    { name: 'BOM import', url: '/api/v1/admin/schemes/TEST/bill-of-materials/imports', limit: workbookUploadMaxBytes, fields: { expectedRevision: '0' }, filename: 'bom.xlsx', mimeType: xlsxMime, atLimit: 415 },
    { name: 'asset create', url: '/api/v1/admin/schemes/TEST/assets', limit: defaultUploadMaxBytes, fields: { name: '模型' }, filename: 'model.skp', mimeType: 'application/octet-stream', atLimit: 400, overFields: { type: 'model', name: '模型' } },
    { name: 'asset replace', url: `/api/v1/admin/schemes/TEST/assets/${assetId}/versions`, limit: defaultUploadMaxBytes, fields: {}, filename: 'drawing.pdf', mimeType: 'application/pdf', atLimit: 400, overFields: { expectedRevision: '1' } },
  ] as const;
  for (const item of cases) {
    await t.test(item.name, async () => {
      const send = (fields: Record<string, string>, size: number) => app.inject({ method: 'POST', url: item.url,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'multipart/form-data; boundary=limit-boundary' },
        payload: multipartBody(fields, { filename: item.filename, mimeType: item.mimeType, size }) });
      const atLimit = await send(item.fields, item.limit);
      if (item.atLimit === 'not-413') assert.notEqual(atLimit.statusCode, 413, atLimit.body);
      else assert.equal(atLimit.statusCode, item.atLimit, atLimit.body);
      businessQueries.length = 0;
      storageWrites.length = 0;

      const over = await send('overFields' in item ? item.overFields : item.fields, item.limit + 1);
      assert.equal(over.statusCode, 413, over.body);
      assert.equal(over.json().error.reason, 'FILE_TOO_LARGE');
      assert.deepEqual(businessQueries, []);
      assert.deepEqual(storageWrites, []);
    });
  }
});
