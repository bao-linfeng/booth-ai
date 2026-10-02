import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { downloadImage, editImage, geminiAspectRatio, IMAGE_LIMITS, ImageGenerationError, normalizeGeneratedImage } from '../src/infra/image-provider.js';
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

test('gemini edits send the documented generateContent payload and keep only final images', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const reference = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#123456' } }).png().toBuffer();
  const model = { purpose: 'artwork', provider: 'gemini', model: modelDefinitions.gemini.model, apiKey: 'gemini-secret',
    revision: 1, unitCredits: 3, priority: 0, enabled: true, credentialConfigured: true } as const;
  assert.equal(model.model, 'gemini-3.1-flash-image');
  const requests: { url: string; headers: Headers; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    assert.ok(init?.signal); assert.equal(init?.redirect, 'error');
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return Response.json({ responseId: 'resp-1', candidates: [{ finishReason: 'STOP', content: { parts: [
      { text: 'draft', thought: true }, { thought: true, inlineData: { mimeType: 'image/png', data: 'ZHJhZnQ=' } },
      { text: 'here you go' }, { inlineData: { mimeType: 'image/jpeg', data: 'ZmluYWw=' } },
    ] } }] });
  };
  const observed: string[] = [];
  const images = await editImage(model, reference, 'artwork prompt', 1, deadline(), { artwork: true, mask: Buffer.from('ignored'), onProviderRequest: id => { observed.push(id); } });
  assert.deepEqual(images, ['data:image/jpeg;base64,ZmluYWw=']);
  assert.deepEqual(observed, ['resp-1']);
  const [request] = requests;
  assert.equal(request?.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent');
  assert.equal(request?.headers.get('x-goog-api-key'), 'gemini-secret');
  assert.equal(request?.url.includes('gemini-secret'), false);
  assert.deepEqual(request?.body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '2K' } });
  const parts = request?.body.contents[0].parts;
  assert.deepEqual(parts[0], { text: 'artwork prompt' });
  assert.equal(parts[1].inlineData.mimeType, 'image/png');
  assert.ok(Buffer.from(parts[1].inlineData.data, 'base64').equals(reference));

  const portrait = await sharp({ create: { width: 900, height: 1600, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  await editImage({ ...model, purpose: 'theme' }, portrait, 'theme prompt', 1, deadline());
  assert.equal(requests[1]?.body.generationConfig.imageConfig.aspectRatio, '9:16');
  assert.equal(requests[1]?.body.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
});

test('gemini aspect ratio picks the closest supported ratio', () => {
  assert.equal(geminiAspectRatio(1792, 1024), '16:9');
  assert.equal(geminiAspectRatio(1536, 1024), '3:2');
  assert.equal(geminiAspectRatio(1000, 1000), '1:1');
  assert.equal(geminiAspectRatio(2520, 1080), '21:9');
  assert.equal(geminiAspectRatio(undefined, 100), '16:9');
});

test('gemini responses without final images are classified instead of silently empty', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const reference = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  const model = { purpose: 'theme', provider: 'gemini', model: modelDefinitions.gemini.model, apiKey: 'secret',
    revision: 1, unitCredits: 3, priority: 0, enabled: true, credentialConfigured: true } as const;
  const cases: [unknown, string, boolean][] = [
    [{ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, 'PROVIDER_CONTENT_BLOCKED', false],
    [{ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }, 'PROVIDER_CONTENT_BLOCKED', false],
    [{ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'I cannot draw that' }] } }] }, 'PROVIDER_NO_IMAGE', false],
    [{ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, inlineData: { mimeType: 'image/png', data: 'ZHJhZnQ=' } }] } }] }, 'PROVIDER_NO_IMAGE', false],
    [{ unexpected: true }, 'PROVIDER_OUTCOME_UNKNOWN', true],
  ];
  for (const [body, code, unknown] of cases) {
    globalThis.fetch = async () => Response.json(body);
    await assert.rejects(editImage(model, reference, 'prompt', 1, deadline()), error =>
      error instanceof ImageGenerationError && error.code === code && !error.retryable && error.outcomeUnknown === unknown);
  }
  globalThis.fetch = async () => new Response('{"error":{"message":"secret upstream"}}', { status: 429 });
  await assert.rejects(editImage(model, reference, 'prompt', 1, deadline()), error =>
    error instanceof ImageGenerationError && error.code === 'PROVIDER_RATE_LIMITED' && error.retryable && !error.message.includes('secret'));
});

test('gemini re-encodes references that would exceed the inline request limit', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const { data, info } = await sharp({ create: { width: 2600, height: 2600, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
    .raw().toBuffer({ resolveWithObject: true });
  const reference = await sharp(data, { raw: info }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(reference.length > 14 * 1024 * 1024);
  let sent: { mimeType: string; data: string } | undefined;
  globalThis.fetch = async (_input, init) => {
    sent = JSON.parse(String(init?.body)).contents[0].parts[1].inlineData;
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmluYWw=' } }] } }] });
  };
  await editImage({ purpose: 'theme', provider: 'gemini', model: modelDefinitions.gemini.model, apiKey: 'secret',
    revision: 1, unitCredits: 3, priority: 0, enabled: true, credentialConfigured: true }, reference, 'prompt', 1, deadline());
  assert.equal(sent?.mimeType, 'image/jpeg');
  assert.ok(Buffer.from(sent!.data, 'base64').length < 14 * 1024 * 1024);
});
