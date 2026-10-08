import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { IMAGE_LIMITS, ImageGenerationError, isOutputAspect, normalizeGeneratedImage } from '../src/infra/ai/image.js';
import { downloadGeneratedImage as downloadImage, imageAdapter, normalizeParams, PROTOCOLS, supportsPurpose } from '../src/infra/ai/protocols.js';
import type { ActiveAiModel, ImageEditRequest } from '../src/infra/ai/types.js';
import { activeModel } from './ai-fixtures.js';

const deadline = () => new Date(Date.now() + 60_000);
const edit = (model: ActiveAiModel, reference: Buffer, prompt: string, options: Partial<ImageEditRequest> = {}) =>
  imageAdapter(model).edit(model, { reference, prompt, count: 1, deadline: deadline(), ...options });

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
  const model = activeModel('openai', 'theme');
  for (const [status, retryable, unknown] of [[400, false, false], [429, true, false], [500, false, true]] as const) {
    globalThis.fetch = async (_input, init) => { assert.ok(init?.signal); return new Response('secret upstream body', { status }); };
    await assert.rejects(edit(model, reference, 'prompt'), error =>
      error instanceof ImageGenerationError && error.retryable === retryable && error.outcomeUnknown === unknown && !error.message.includes('secret'));
  }
  globalThis.fetch = async () => { throw new Error('network reset secret'); };
  await assert.rejects(edit(model, reference, 'prompt'), error => error instanceof ImageGenerationError && error.outcomeUnknown);
  globalThis.fetch = async () => new Response('malformed JSON');
  await assert.rejects(edit(model, reference, 'prompt'), /PROVIDER_OUTCOME_UNKNOWN/);
});

test('gemini edits send the documented generateContent payload and keep only final images', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const reference = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#123456' } }).png().toBuffer();
  const model = activeModel('gemini', 'artwork', { apiKey: 'gemini-secret' });
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
  const images = await edit(model, reference, 'artwork prompt', { mask: Buffer.from('ignored'), onProviderRequest: id => { observed.push(id); } });
  assert.deepEqual(images, ['data:image/jpeg;base64,ZmluYWw=']);
  assert.deepEqual(observed, ['resp-1']);
  const [request] = requests;
  assert.equal(request?.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent');
  assert.equal(request?.headers.get('x-goog-api-key'), 'gemini-secret');
  assert.equal(request?.url.includes('gemini-secret'), false);
  assert.deepEqual(request?.body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } });
  const parts = request?.body.contents[0].parts;
  assert.deepEqual(parts[0], { text: 'artwork prompt' });
  assert.equal(parts[1].inlineData.mimeType, 'image/png');
  assert.ok(Buffer.from(parts[1].inlineData.data, 'base64').equals(reference));

  const portrait = await sharp({ create: { width: 900, height: 1600, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  await edit(activeModel('gemini', 'theme', { apiKey: 'gemini-secret' }), portrait, 'theme prompt');
  assert.equal(requests[1]?.body.generationConfig.imageConfig.aspectRatio, '16:9');
  assert.equal(requests[1]?.body.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
});

test('output aspect accepts 16:9 within tolerance only', () => {
  for (const [w, h] of [[2048, 1152], [1792, 1008], [2752, 1536]] as const) assert.equal(isOutputAspect(w, h), true);
  for (const [w, h] of [[1536, 1024], [1024, 1024], [1024, 1792], [100, 0]] as const) assert.equal(isOutputAspect(w, h), false);
});

test('gemini responses without final images are classified instead of silently empty', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const reference = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  const model = activeModel('gemini', 'theme');
  const cases: [unknown, string, boolean][] = [
    [{ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, 'PROVIDER_CONTENT_BLOCKED', false],
    [{ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }, 'PROVIDER_CONTENT_BLOCKED', false],
    [{ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'I cannot draw that' }] } }] }, 'PROVIDER_NO_IMAGE', false],
    [{ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, inlineData: { mimeType: 'image/png', data: 'ZHJhZnQ=' } }] } }] }, 'PROVIDER_NO_IMAGE', false],
    [{ unexpected: true }, 'PROVIDER_OUTCOME_UNKNOWN', true],
  ];
  for (const [body, code, unknown] of cases) {
    globalThis.fetch = async () => Response.json(body);
    await assert.rejects(edit(model, reference, 'prompt'), error =>
      error instanceof ImageGenerationError && error.code === code && !error.retryable && error.outcomeUnknown === unknown);
  }
  globalThis.fetch = async () => new Response('{"error":{"message":"secret upstream"}}', { status: 429 });
  await assert.rejects(edit(model, reference, 'prompt'), error =>
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
  await edit(activeModel('gemini', 'theme'), reference, 'prompt');
  assert.equal(sent?.mimeType, 'image/jpeg');
  assert.ok(Buffer.from(sent!.data, 'base64').length < 14 * 1024 * 1024);
});

test('protocol registry declares capabilities, purposes and parameter schemas consistently', () => {
  assert.equal(new Set(PROTOCOLS.map(protocol => protocol.id)).size, PROTOCOLS.length);
  for (const protocol of PROTOCOLS) {
    assert.match(protocol.defaultBaseUrl, /^https:\/\//);
    assert.ok(protocol.listModels || protocol.suggestedModels.length, `${protocol.id} needs discovery or suggestions`);
    if (protocol.image) assert.ok(protocol.image.adapter.maxImagesPerRequest >= 1 && protocol.image.purposes.length);
    for (const capability of [protocol.text, protocol.image]) for (const field of capability?.params ?? []) {
      const defaults = normalizeParams(protocol.id, capability === protocol.text ? 'text' : 'image', {});
      assert.equal(defaults[field.key], field.default);
    }
  }
  assert.equal(supportsPurpose('dashscope', 'image', 'artwork'), false);
  assert.equal(supportsPurpose('openai', 'text', 'theme'), false);
  assert.equal(supportsPurpose('gemini', 'image', 'artwork'), true);
  assert.throws(() => normalizeParams('gemini', 'image', { imageSize: '1K' }), /Invalid model parameter/);
  assert.throws(() => normalizeParams('openai', 'text', { temperature: 3 }), /Invalid model parameter/);
  assert.throws(() => normalizeParams('openai', 'text', { unknown: 1 }), /Unknown model parameter/);
  assert.throws(() => imageAdapter({ protocol: 'openai', kind: 'text' }), /PROVIDER_UNSUPPORTED/);
});

test('adapters honour the configured base URL and refuse private endpoints before submitting', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const reference = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  const urls: string[] = [];
  globalThis.fetch = async input => { urls.push(String(input)); return Response.json({ data: [{ b64_json: 'aW1n' }] }); };
  await edit(activeModel('openai', 'theme', { baseUrl: 'https://203.0.113.10/proxy/v1' }), reference, 'prompt');
  assert.deepEqual(urls, ['https://203.0.113.10/proxy/v1/images/edits']);
  for (const baseUrl of ['https://127.0.0.1/v1', 'https://10.1.2.3/v1', 'https://[::1]/v1', 'http://api.openai.com/v1']) {
    await assert.rejects(edit(activeModel('openai', 'theme', { baseUrl }), reference, 'prompt'), error =>
      error instanceof ImageGenerationError && error.code === 'PROVIDER_ENDPOINT_INVALID' && !error.retryable && !error.outcomeUnknown);
  }
  assert.equal(urls.length, 1);
});

test('openai adapter derives size and quality from the purpose and model params', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const reference = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  const forms: FormData[] = [];
  globalThis.fetch = async (_input, init) => { forms.push(init?.body as FormData); return Response.json({ data: [{ b64_json: 'aW1n' }] }); };
  assert.deepEqual(await edit(activeModel('openai', 'artwork'), reference, 'prompt'), ['data:image/png;base64,aW1n']);
  await edit(activeModel('openai', 'theme'), reference, 'prompt', { count: 3, mask: reference });
  await edit(activeModel('openai', 'theme', { params: { quality: 'medium' } }), reference, 'prompt');
  assert.deepEqual([forms[0]?.get('model'), forms[0]?.get('size'), forms[0]?.get('quality'), forms[0]?.get('n')], ['gpt-image-1.5', '2048x1152', 'high', '1']);
  assert.deepEqual([forms[1]?.get('size'), forms[1]?.get('quality'), forms[1]?.get('n'), forms[1]?.has('mask')], ['1792x1008', null, '3', true]);
  assert.equal(forms[2]?.get('quality'), 'medium');
});

test('qwen-image edits send the multimodal payload synchronously and collect every result image', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const reference = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#123456' } }).png().toBuffer();
  const requests: { url: string; headers: Headers; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    assert.ok(init?.signal); assert.equal(init?.redirect, 'error');
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return Response.json({ request_id: 'qwen-req-1', output: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [
      { image: 'https://dashscope-a717.oss-accelerate.aliyuncs.com/a.png?Expires=1', type: 'image' },
      { image: 'https://dashscope-a717.oss-accelerate.aliyuncs.com/b.png?Expires=1', type: 'image' }] } }] } });
  };
  const observed: string[] = [];
  const model = activeModel('qwen-image', 'artwork', { apiKey: 'qwen-secret' });
  const images = await edit(model, reference, 'artwork prompt', { count: 2, mask: reference, onProviderRequest: id => { observed.push(id); } });
  assert.equal(images.length, 2);
  assert.deepEqual(observed, ['qwen-req-1']);
  const [request] = requests;
  assert.equal(request?.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(request?.headers.get('authorization'), 'Bearer qwen-secret');
  assert.equal(request?.headers.get('x-dashscope-async'), null);
  assert.equal(request?.body.model, 'qwen-image-3.0-pro');
  assert.deepEqual(request?.body.parameters, { n: 2, size: '2048*1152', prompt_extend: false, watermark: false });
  const [image, text] = request?.body.input.messages[0].content;
  assert.deepEqual(text, { text: 'artwork prompt' });
  assert.equal(image.image, `data:image/png;base64,${reference.toString('base64')}`);
  assert.equal(supportsPurpose('qwen-image', 'image', 'artwork'), true);
  assert.equal(imageAdapter(model).maxImagesPerRequest, 6);
});

test('qwen-image shrinks oversized references and classifies empty or malformed responses', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const large = await sharp({ create: { width: 4000, height: 2250, channels: 3, background: '#123456' } }).png().toBuffer();
  let sent = '';
  globalThis.fetch = async (_input, init) => {
    sent = JSON.parse(String(init?.body)).input.messages[0].content[0].image;
    return Response.json({ output: { choices: [{ message: { content: [{ image: 'https://dashscope.oss-cn-beijing.aliyuncs.com/a.png' }] } }] } });
  };
  await edit(activeModel('qwen-image', 'theme'), large, 'prompt');
  assert.match(sent, /^data:image\/jpeg;base64,/);
  const { width, height } = await sharp(Buffer.from(sent.split(',')[1]!, 'base64')).metadata();
  assert.deepEqual([width, height], [3072, 1728]);

  const reference = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  const cases: [unknown, string, boolean][] = [
    [{ output: { choices: [{ message: { content: [{ text: 'no image' }] } }] } }, 'PROVIDER_NO_IMAGE', false],
    [{ code: 'Unexpected' }, 'PROVIDER_OUTCOME_UNKNOWN', true],
  ];
  for (const [body, code, unknown] of cases) {
    globalThis.fetch = async () => Response.json(body);
    await assert.rejects(edit(activeModel('qwen-image', 'theme'), reference, 'prompt'), error =>
      error instanceof ImageGenerationError && error.code === code && !error.retryable && error.outcomeUnknown === unknown);
  }
  globalThis.fetch = async () => new Response('{"code":"DataInspectionFailed","message":"secret upstream"}', { status: 400 });
  await assert.rejects(edit(activeModel('qwen-image', 'theme'), reference, 'prompt'), error =>
    error instanceof ImageGenerationError && error.code === 'PROVIDER_REQUEST_FAILED' && !error.retryable && !error.outcomeUnknown);
});

test('ark seedream edits send one inline reference per call and return base64 results as data URLs', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const reference = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#123456' } }).png().toBuffer();
  const requests: { url: string; headers: Headers; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    assert.ok(init?.signal); assert.equal(init?.redirect, 'error');
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return Response.json({ model: 'doubao-seedream-5-0-flash-260915', created: 1, data: [{ b64_json: 'aGVsbG8=', size: '2560x1440' }] },
      { headers: { 'x-request-id': 'ark-req-1' } });
  };
  const observed: string[] = [];
  const model = activeModel('ark', 'artwork', { apiKey: 'ark-secret' });
  const images = await edit(model, reference, 'artwork prompt', { mask: reference, onProviderRequest: id => { observed.push(id); } });
  assert.deepEqual(images, ['data:image/jpeg;base64,aGVsbG8=']);
  assert.deepEqual(observed, ['ark-req-1']);
  const [request] = requests;
  assert.equal(request?.url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
  assert.equal(request?.headers.get('authorization'), 'Bearer ark-secret');
  const { image, ...rest } = request?.body;
  assert.deepEqual(rest, { model: 'doubao-seedream-5-0-flash-260915', prompt: 'artwork prompt', size: '2560x1440',
    response_format: 'b64_json', watermark: false, stream: false });
  assert.equal(image, `data:image/png;base64,${reference.toString('base64')}`);
  assert.equal(supportsPurpose('ark', 'image', 'artwork'), true);
  assert.equal(supportsPurpose('ark', 'image', 'theme'), true);
  assert.equal(imageAdapter(model).maxImagesPerRequest, 1);

  globalThis.fetch = async () => Response.json({ data: [{ b64_json: 'aGVsbG8=', output_format: 'png' }] });
  assert.deepEqual(await edit(model, reference, 'prompt'), ['data:image/png;base64,aGVsbG8=']);
});

test('ark seedream shrinks oversized references and classifies blocked, empty or malformed responses', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const large = await sharp({ create: { width: 5000, height: 2500, channels: 3, background: '#123456' } }).png().toBuffer();
  let sent = '';
  globalThis.fetch = async (_input, init) => {
    sent = JSON.parse(String(init?.body)).image;
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
  };
  await edit(activeModel('ark', 'theme'), large, 'prompt');
  assert.match(sent, /^data:image\/jpeg;base64,/);
  const { width, height } = await sharp(Buffer.from(sent.split(',')[1]!, 'base64')).metadata();
  assert.deepEqual([width, height], [4096, 2048]);

  const reference = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  const cases: [unknown, string, boolean][] = [
    [{ data: [{ error: { code: 'OutputImageSensitiveContentDetected', message: 'secret' } }] }, 'PROVIDER_CONTENT_BLOCKED', false],
    [{ data: [] }, 'PROVIDER_NO_IMAGE', false],
    [{ error: { code: 'Unexpected' } }, 'PROVIDER_OUTCOME_UNKNOWN', true],
  ];
  for (const [body, code, unknown] of cases) {
    globalThis.fetch = async () => Response.json(body);
    await assert.rejects(edit(activeModel('ark', 'theme'), reference, 'prompt'), error =>
      error instanceof ImageGenerationError && error.code === code && !error.retryable && error.outcomeUnknown === unknown && !error.message.includes('secret'));
  }
  globalThis.fetch = async () => new Response('{"error":{"code":"InputImageSensitiveContentDetected","message":"secret upstream"}}', { status: 400 });
  await assert.rejects(edit(activeModel('ark', 'theme'), reference, 'prompt'), error =>
    error instanceof ImageGenerationError && error.code === 'PROVIDER_REQUEST_FAILED' && !error.retryable && !error.outcomeUnknown);
});
