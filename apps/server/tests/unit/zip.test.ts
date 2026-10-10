import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buffer as streamBuffer } from 'node:stream/consumers';
import test from 'node:test';
import JSZip from 'jszip';
import { storedZipStream } from '../../src/infra/zip.js';

const chunks = async function* (...parts: string[]) { for (const part of parts) yield Buffer.from(part); };

test('stored ZIP stream round-trips multi-chunk entries and UTF-8 names', async () => {
  const large = Buffer.alloc(256 * 1024, 7);
  const opened: string[] = [];
  const stream = storedZipStream([
    { name: 'front.png', open: async () => { opened.push('front'); return chunks('he', 'llo'); } },
    { name: '四面素材/back.png', open: async () => { opened.push('back'); return [large.subarray(0, 1000), large.subarray(1000)]; } },
    { name: 'empty.txt', open: async () => [] },
  ], new Date(2026, 9, 2, 12, 30, 10));
  assert.deepEqual(opened, [], 'entries open lazily');
  const zip = await JSZip.loadAsync(await streamBuffer(stream), { checkCRC32: true });
  assert.deepEqual(opened, ['front', 'back']);
  assert.equal(await zip.file('front.png')!.async('string'), 'hello');
  const back = await zip.file('四面素材/back.png')!.async('nodebuffer');
  assert.equal(createHash('sha256').update(back).digest('hex'), createHash('sha256').update(large).digest('hex'));
  assert.equal((await zip.file('empty.txt')!.async('nodebuffer')).length, 0);
  assert.equal(zip.file('front.png')!.date.getFullYear(), 2026);
});

test('stored ZIP stream fails instead of producing a valid archive when an entry fails', async () => {
  const stream = storedZipStream([
    { name: 'ok.png', open: async () => chunks('ok') },
    { name: 'bad.png', open: async () => (async function* () { yield Buffer.from('partial'); throw new Error('integrity mismatch'); })() },
  ]);
  await assert.rejects(streamBuffer(stream), /integrity mismatch/);
});
