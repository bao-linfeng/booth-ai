import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { createStorage } from '../src/infra/storage.js';

test('bounded S3 binary reads preserve bytes and reject oversized and unavailable objects', async t => {
  const bytes = Buffer.from([0, 255, 128, 1]);
  const server = createServer((request, response) => {
    if (request.url?.includes('missing')) {
      response.writeHead(404, { 'Content-Type': 'application/xml' });
      response.end('<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    response.setHeader('Content-Type', 'application/octet-stream');
    if (request.url?.includes('chunked')) {
      response.write(bytes);
      response.end(bytes);
    } else {
      response.setHeader('Content-Length', bytes.length);
      response.end(bytes);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const storage = createStorage(loadConfig({
    NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
    S3_ENDPOINT: endpoint, S3_PUBLIC_ENDPOINT: endpoint, S3_BUCKET: 'test',
    S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only',
    EXTERNAL_API_URL: 'https://api.example.test',
    SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
  }));
  t.after(() => storage.close());
  assert.deepEqual(await storage.getBuffer('binary', bytes.length), bytes);
  await assert.rejects(storage.getBuffer('binary', bytes.length - 1), /size limit/);
  await assert.rejects(storage.getBuffer('chunked', bytes.length), /size limit/);
  await assert.rejects(storage.getBuffer('missing', bytes.length));
  await assert.rejects(storage.getBuffer('binary', 0), /Invalid object size limit/);
});
