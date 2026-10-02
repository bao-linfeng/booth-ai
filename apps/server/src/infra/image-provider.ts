import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import type { ActiveAiModel } from './ai-models.js';

export const IMAGE_LIMITS = { maxBytes: 30 * 1024 * 1024, maxPixels: 40_000_000 };
export const GENERATION_LEASE_MINUTES = 15;
export const GENERATION_DEADLINE_MINUTES = 30;

export class ImageGenerationError extends Error {
  constructor(public readonly code: string, public readonly retryable = false, public readonly outcomeUnknown = false) {
    super(code);
  }
}

function requestSignal(deadline: Date, timeout: number): AbortSignal {
  const remaining = deadline.getTime() - Date.now();
  if (remaining <= 0) throw new ImageGenerationError('GENERATION_DEADLINE_EXCEEDED');
  return AbortSignal.timeout(Math.max(1, Math.min(remaining, timeout)));
}

async function readBytes(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new ImageGenerationError('IMAGE_BODY_MISSING', true);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > maxBytes) throw new ImageGenerationError('IMAGE_SIZE_INVALID');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ImageGenerationError('IMAGE_SIZE_INVALID');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function downloadImage(url: string, deadline: Date): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    const encoded = match?.[1];
    if (!encoded) throw new ImageGenerationError('IMAGE_FORMAT_INVALID');
    if (encoded.length > Math.ceil(IMAGE_LIMITS.maxBytes * 4 / 3) + 4) throw new ImageGenerationError('IMAGE_SIZE_INVALID');
    return Buffer.from(encoded, 'base64');
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ImageGenerationError('IMAGE_URL_INVALID'); }
  const hosts = ['blob.core.windows.net', 'aliyuncs.com', 'googleusercontent.com', 'openai.com'];
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== '443') || !hosts.some(host => parsed.hostname.endsWith(`.${host}`))) {
    throw new ImageGenerationError('IMAGE_URL_UNTRUSTED');
  }
  try {
    const response = await fetch(url, { redirect: 'error', signal: requestSignal(deadline, 30_000) });
    if (!response.ok) throw new ImageGenerationError('IMAGE_DOWNLOAD_FAILED', response.status === 429 || response.status >= 500);
    return await readBytes(response, IMAGE_LIMITS.maxBytes);
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    throw new ImageGenerationError('IMAGE_DOWNLOAD_UNAVAILABLE', true);
  }
}

export async function normalizeGeneratedImage(bytes: Buffer, minLongEdge = 1, minShortEdge = 1) {
  if (!bytes.length || bytes.length > IMAGE_LIMITS.maxBytes) throw new ImageGenerationError('IMAGE_SIZE_INVALID');
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: IMAGE_LIMITS.maxPixels });
    const metadata = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new ImageGenerationError('IMAGE_FORMAT_INVALID');
    const { data, info } = await image.rotate().toColourspace('srgb').png().toBuffer({ resolveWithObject: true });
    if (Math.max(info.width, info.height) < minLongEdge || Math.min(info.width, info.height) < minShortEdge) throw new ImageGenerationError('IMAGE_RESOLUTION_TOO_LOW');
    if (data.length > IMAGE_LIMITS.maxBytes) throw new ImageGenerationError('IMAGE_SIZE_INVALID');
    return { bytes: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    throw new ImageGenerationError('IMAGE_FORMAT_INVALID');
  }
}

// Provider request identifiers are opaque diagnostics; keep only safe, bounded tokens.
export function providerRequestId(headers: Pick<Headers, 'get'>, body: unknown): string | undefined {
  const fromBody = body && typeof body === 'object' ? (body as { request_id?: unknown; responseId?: unknown }) : {};
  const candidate = headers.get('x-request-id') ?? fromBody.request_id ?? fromBody.responseId;
  return typeof candidate === 'string' && /^[\w.:-]{1,128}$/.test(candidate) ? candidate : undefined;
}

type ProviderRequestObserver = (requestId: string) => Promise<void> | void;

// Recording diagnostics must never change how the provider outcome is classified.
async function observeProviderRequest(observe: ProviderRequestObserver | undefined, headers: Pick<Headers, 'get'>, body: unknown) {
  const requestId = providerRequestId(headers, body);
  if (requestId && observe) try { await observe(requestId); } catch {}
}

async function providerJson(url: string, init: RequestInit, deadline: Date, submitting: boolean, observe?: ProviderRequestObserver): Promise<unknown> {
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: requestSignal(deadline, submitting ? 180_000 : 30_000) });
    if (!response.ok) {
      await observeProviderRequest(observe, response.headers, undefined);
      await response.body?.cancel().catch(() => {});
      throw new ImageGenerationError(response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REQUEST_FAILED',
        response.status === 429 || (!submitting && response.status >= 500), submitting && response.status >= 500);
    }
    const bytes = await readBytes(response, Math.ceil(IMAGE_LIMITS.maxBytes * 4 / 3) * 4 + 1024 * 1024);
    const body = JSON.parse(bytes.toString('utf8')) as unknown;
    await observeProviderRequest(observe, response.headers, body);
    return body;
  } catch (error) {
    if (error instanceof ImageGenerationError && error.code.startsWith('PROVIDER_')) throw error;
    throw new ImageGenerationError(submitting ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_POLL_UNAVAILABLE', !submitting, submitting);
  }
}

export async function editImage(model: ActiveAiModel, reference: Buffer, prompt: string, count: number,
  deadline: Date, options: { mask?: Buffer; artwork?: boolean; sourceUrl?: string; onSubmitted?: (taskId: string) => Promise<void>; onProviderRequest?: ProviderRequestObserver } = {}): Promise<string[]> {
  if (model.provider === 'wanx') {
    const body = await providerJson('https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis', {
      method: 'POST', headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model: model.model, input: { function: 'description_edit', prompt, base_image_url: options.sourceUrl }, parameters: { n: count } }),
    }, deadline, true, options.onProviderRequest) as { output?: { task_id?: string } };
    if (typeof body?.output?.task_id !== 'string' || !body.output.task_id) throw new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
    await options.onSubmitted?.(body.output.task_id);
    return pollWanx(model, body.output.task_id, deadline);
  }
  const metadata = await sharp(reference, { limitInputPixels: IMAGE_LIMITS.maxPixels }).metadata();
  const mimeType = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'webp' ? 'image/webp' : 'image/png';
  if (model.provider === 'gemini') {
    const body = await providerJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': model.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: reference.toString('base64') } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
    }, deadline, true, options.onProviderRequest) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
    if (!Array.isArray(body?.candidates)) throw new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
    return body.candidates.flatMap(candidate => Array.isArray(candidate?.content?.parts) ? candidate.content.parts.flatMap(part =>
      typeof part?.inlineData?.data === 'string' ? [`data:${part.inlineData.mimeType ?? 'image/png'};base64,${part.inlineData.data}`] : []) : []);
  }
  if (model.provider !== 'openai') throw new ImageGenerationError('PROVIDER_UNSUPPORTED');
  const form = new FormData();
  form.set('model', model.model);
  form.set('image', new Blob([new Uint8Array(reference)], { type: mimeType }), 'source.png');
  form.set('prompt', prompt);
  form.set('n', String(count));
  form.set('size', options.artwork ? '1536x1024' : '1792x1024');
  if (options.artwork) { form.set('quality', 'high'); form.set('output_format', 'png'); }
  if (options.mask) form.set('mask', new Blob([new Uint8Array(options.mask)], { type: 'image/png' }), 'mask.png');
  const body = await providerJson('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${model.apiKey}` }, body: form,
  }, deadline, true, options.onProviderRequest) as { data?: { b64_json?: string; url?: string }[] };
  if (!Array.isArray(body?.data)) throw new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
  return body.data.flatMap(item => typeof item?.b64_json === 'string' && item.b64_json ? [`data:image/png;base64,${item.b64_json}`] :
    typeof item?.url === 'string' && item.url ? [item.url] : []);
}

export async function pollWanx(model: ActiveAiModel, taskId: string, deadline: Date): Promise<string[]> {
  const pollDeadline = new Date(Math.min(deadline.getTime(), Date.now() + 180_000));
  for (let attempt = 0; attempt < 60; attempt++) {
    if (pollDeadline.getTime() <= Date.now()) throw new ImageGenerationError('PROVIDER_POLL_UNAVAILABLE', true);
    await delay(2000, undefined, { signal: requestSignal(pollDeadline, 180_000) });
    const body = await providerJson(`https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${model.apiKey}` },
    }, pollDeadline, false) as { output?: { task_status?: string; results?: { url?: string }[] } };
    if (body?.output?.task_status === 'SUCCEEDED') {
      if (!Array.isArray(body.output.results)) throw new ImageGenerationError('PROVIDER_POLL_UNAVAILABLE', true);
      return body.output.results.flatMap(item => typeof item?.url === 'string' && item.url ? [item.url] : []);
    }
    if (body?.output?.task_status === 'FAILED' || body?.output?.task_status === 'CANCELED') throw new ImageGenerationError('PROVIDER_GENERATION_FAILED');
  }
  throw new ImageGenerationError('PROVIDER_POLL_UNAVAILABLE', true);
}
