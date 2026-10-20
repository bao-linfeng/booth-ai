import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { loadConfig } from '../../src/config.js';
import { createStorage } from '../../src/infra/storage.js';

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
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const storage = createStorage(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://localhost/test',
      REDIS_URL: 'redis://localhost',
      S3_ENDPOINT: endpoint,
      S3_PUBLIC_ENDPOINT: endpoint,
      S3_BUCKET: 'test',
      S3_ACCESS_KEY: 'test-only',
      S3_SECRET_KEY: 'test-only',
      EXTERNAL_API_URL: 'https://api.example.test',
      SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes',
      AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
    }),
  );
  t.after(() => storage.close());
  assert.deepEqual(await storage.getBuffer('binary', bytes.length), bytes);
  await assert.rejects(storage.getBuffer('binary', bytes.length - 1), /size limit/);
  await assert.rejects(storage.getBuffer('chunked', bytes.length), /size limit/);
  await assert.rejects(storage.getBuffer('missing', bytes.length));
  await assert.rejects(storage.getBuffer('binary', 0), /Invalid object size limit/);
  const streamed: Uint8Array[] = [];
  for await (const chunk of await storage.openRead('chunked', bytes.length * 2)) streamed.push(chunk);
  assert.deepEqual(Buffer.concat(streamed), Buffer.concat([bytes, bytes]));
  await assert.rejects(async () => {
    for await (const _ of await storage.openRead('chunked', bytes.length));
  }, /size limit/);
  await assert.rejects(storage.openRead('binary', bytes.length - 1), /size limit/);
  assert.equal(await storage.objectSize('binary'), bytes.length);
  await assert.rejects(storage.objectSize('missing'));
});

test('signed download URLs stay identical within a signing window and carry a cache policy', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 20, 8, 0, 30) });
  const storage = createStorage(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://localhost/test',
      REDIS_URL: 'redis://localhost',
      S3_ENDPOINT: 'http://127.0.0.1:9',
      S3_PUBLIC_ENDPOINT: 'https://files.example.test',
      S3_BUCKET: 'test',
      S3_ACCESS_KEY: 'test-only',
      S3_SECRET_KEY: 'test-only',
      EXTERNAL_API_URL: 'https://api.example.test',
      SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes',
      AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
    }),
  );
  t.after(() => storage.close());
  const first = new URL(await storage.signDownload('a/b.png', 300));
  t.mock.timers.tick(9 * 60 * 1000);
  const sameWindow = new URL(await storage.signDownload('a/b.png', 300));
  assert.equal(sameWindow.href, first.href);
  assert.equal(first.searchParams.get('X-Amz-Date'), '20261020T080000Z');
  // 窗口起点 + 300 秒 + 一个窗口，剩余有效期不少于调用方要求的 300 秒
  assert.equal(first.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(first.searchParams.get('response-cache-control'), 'private, max-age=900, immutable');

  t.mock.timers.tick(60 * 1000);
  const nextWindow = new URL(await storage.signDownload('a/b.png', 300));
  assert.equal(nextWindow.searchParams.get('X-Amz-Date'), '20261020T081000Z');
  assert.notEqual(nextWindow.href, first.href);

  const named = new URL(await storage.signDownloadWithName('a/b.png', '方案.png', 60));
  assert.equal(named.searchParams.get('X-Amz-Expires'), '660');
  assert.match(named.searchParams.get('response-content-disposition') ?? '', /^attachment;/);
  assert.equal(named.searchParams.get('response-cache-control'), 'private, max-age=660, immutable');
  await assert.rejects(storage.signDownload('a/b.png', 901), /Invalid signed URL lifetime/);
});
