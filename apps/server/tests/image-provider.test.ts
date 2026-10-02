import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { downloadImage, editImage, IMAGE_LIMITS, ImageGenerationError, normalizeGeneratedImage } from '../src/infra/image-provider.js';
import { modelDefinitions } from '../src/infra/ai-models.js';

const deadline = () => new Date(Date.now() + 60_000);

test('image acceptance detects actual format, normalizes PNG and rejects malformed or oversized images', async () => {
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  const result = await normalizeGeneratedImage(jpeg);
  assert.equal((await sharp(result.bytes).metadata()).format, 'png');
  await assert.rejects(normalizeGeneratedImage(Buffer.from('fake PNG')), /IMAGE_FORMAT_INVALID/);
  await assert.rejects(normalizeGeneratedImage(Buffer.alloc(IMAGE_LIMITS.maxBytes + 1)), /IMAGE_SIZE_INVALID/);
  await assert.rejects(normalizeGeneratedImage(jpeg, 1536, 1024), /IMAGE_RESOLUTION_TOO_LOW/);
  await assert.rejects(downloadImage('data:image/png;base64,???', deadline()), /IMAGE_FORMAT_INVALID/);
});

test('generated download is bounded, timed and rejects untrusted URLs or redirects', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++; assert.ok(init?.signal); assert.equal(init?.redirect, 'error');
    return new Response('x', { headers: { 'content-length': String(IMAGE_LIMITS.maxBytes + 1) } });
  };
  for (const url of ['http://assets.openai.com/x', 'https://openai.com.attacker.test/x', 'https://127.0.0.1/x', 'https://user:pass@assets.openai.com/x']) {
    await assert.rejects(downloadImage(url, deadline()), /IMAGE_URL_UNTRUSTED/);
  }
  assert.equal(calls, 0);
  await assert.rejects(downloadImage('https://assets.openai.com/x', deadline()), /IMAGE_SIZE_INVALID/);
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(IMAGE_LIMITS.maxBytes)); controller.enqueue(new Uint8Array(1)); controller.close();
  } }));
  await assert.rejects(downloadImage('https://assets.openai.com/x', deadline()), /IMAGE_SIZE_INVALID/);
  globalThis.fetch = async () => { throw new Error('signed URL and credential must never be logged'); };
  await assert.rejects(downloadImage('https://assets.openai.com/x', deadline()), error => error instanceof ImageGenerationError && error.retryable && !error.message.includes('credential'));
});

test('supplier errors distinguish explicit rejection from uncertain acceptance without leaking response bodies', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const reference = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  const model = { purpose: 'theme', provider: 'openai', model: modelDefinitions.openai.model, apiKey: 'secret',
    revision: 1, unitCredits: 3, priority: 1, enabled: true, credentialConfigured: true } as const;
  for (const [status, retryable, unknown] of [[400, false, false], [429, true, false], [500, false, true]] as const) {
    globalThis.fetch = async (_input, init) => { assert.ok(init?.signal); return new Response('secret upstream body', { status }); };
    await assert.rejects(editImage(model, reference, 'prompt', 1, deadline()), error =>
      error instanceof ImageGenerationError && error.retryable === retryable && error.outcomeUnknown === unknown && !error.message.includes('secret'));
  }
  globalThis.fetch = async () => { throw new Error('network reset secret'); };
  await assert.rejects(editImage(model, reference, 'prompt', 1, deadline()), error => error instanceof ImageGenerationError && error.outcomeUnknown);
  globalThis.fetch = async () => new Response('malformed JSON');
  await assert.rejects(editImage(model, reference, 'prompt', 1, deadline()), /PROVIDER_OUTCOME_UNKNOWN/);
});
