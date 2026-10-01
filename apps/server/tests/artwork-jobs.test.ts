import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import type { Queue } from 'bullmq';
import sharp from 'sharp';
import { normalizeArtworkImage } from '../src/modules/tasks/artwork-worker.js';
import { dispatchArtworkOutbox } from '../src/modules/tasks/artwork-outbox.js';

test('artwork acceptance converts actual JPEG pixels to PNG and rejects low resolution, corrupt and oversized content', async () => {
  const jpeg = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#345678' } }).jpeg().toBuffer();
  const image = await normalizeArtworkImage(jpeg);
  assert.deepEqual([...image.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.width, 1536); assert.equal(image.height, 1024);
  assert.equal((await sharp(image.bytes).metadata()).format, 'png');
  const small = await sharp(jpeg).resize(1024, 683).png().toBuffer();
  await assert.rejects(normalizeArtworkImage(small), /ARTWORK_RESOLUTION_TOO_LOW/);
  await assert.rejects(normalizeArtworkImage(Buffer.from('fake PNG')));
  await assert.rejects(normalizeArtworkImage(jpeg.subarray(0, 100)));
  await assert.rejects(normalizeArtworkImage(Buffer.alloc(30 * 1024 * 1024 + 1)), /ARTWORK_SIZE_INVALID/);
});

test('artwork outbox rolls back when queue unavailable and marks dispatch only after successful enqueue', async () => {
  const events: string[] = [];
  const client = { query: async (sql: string) => {
    events.push(sql);
    return sql.includes('SELECT job_id') ? { rows: [{ jobId: 'task' }] } : { rows: [] };
  }, release: () => {} };
  const pool = { query: async () => ({ rows: [] }), connect: async () => client } as unknown as pg.Pool;
  await assert.rejects(dispatchArtworkOutbox(pool, { add: async () => { events.push('ENQUEUE_FAILED'); throw new Error('Redis unavailable'); } } as unknown as Queue));
  assert.equal(events.at(-1), 'ROLLBACK');
  assert.ok(!events.some(e => e.includes('picked_at = now()') || e === 'COMMIT'));
  events.length = 0;
  await dispatchArtworkOutbox(pool, { add: async (_name: string, _body: unknown, options: { jobId: string }) => { assert.equal(options.jobId, 'task'); events.push('ENQUEUED'); } } as unknown as Queue);
  assert.ok(events.indexOf('ENQUEUED') < events.findIndex(e => e.includes('picked_at = now()')));
  assert.equal(events.at(-1), 'COMMIT');
});
