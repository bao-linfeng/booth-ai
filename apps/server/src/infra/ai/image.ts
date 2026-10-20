import sharp from 'sharp';
import { assertPublicEndpoint } from './endpoint.js';
import type { ProviderRequestObserver } from './types.js';

export const IMAGE_LIMITS = { maxBytes: 30 * 1024 * 1024, maxPixels: 40_000_000 };
/** 换主题与四面素材统一产出 16:9 横图；供应商实际尺寸允许在容差内取整。 */
export const OUTPUT_ASPECT = { label: '16:9', ratio: 16 / 9, tolerance: 0.02 } as const;
export const isOutputAspect = (width: number, height: number) =>
  height > 0 && Math.abs(width / height / OUTPUT_ASPECT.ratio - 1) <= OUTPUT_ASPECT.tolerance;
export const GENERATION_LEASE_MINUTES = 15;
export const GENERATION_DEADLINE_MINUTES = 30;

export class ImageGenerationError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = false,
    public readonly outcomeUnknown = false,
  ) {
    super(code);
  }
}

/** 距任务截止与单次超时中较早者的剩余毫秒数；任务已截止时抛错。 */
function requestTimeout(deadline: Date, timeout: number): number {
  const remaining = deadline.getTime() - Date.now();
  if (remaining <= 0) throw new ImageGenerationError('GENERATION_DEADLINE_EXCEEDED');
  return Math.max(1, Math.min(remaining, timeout));
}

export function requestSignal(deadline: Date, timeout: number): AbortSignal {
  return AbortSignal.timeout(requestTimeout(deadline, timeout));
}

/** 提交请求等待响应头的超时：同步接口出图期间连接上没有数据。 */
const SUBMIT_HEADERS_TIMEOUT_MS = 180_000;
const POLL_TIMEOUT_MS = 30_000;
/**
 * 收到响应头后，图已生成并计费。服务器到供应商的跨境链路可能很慢（数 MB 的 base64 要下载几十秒到数分钟），
 * 所以响应体不受上面的超时约束：持续有数据就继续读，只在长时间收不到数据或总时长超限时放弃。
 * 等待响应头加读取响应体的最长时间须小于生成任务租约（GENERATION_LEASE_MINUTES）。
 */
const BODY_IDLE_TIMEOUT_MS = 60_000;
const BODY_TIMEOUT_MS = 300_000;

async function readBytes(response: Response, maxBytes: number, onProgress?: () => void): Promise<Buffer> {
  if (!response.body) throw new ImageGenerationError('IMAGE_BODY_MISSING', true);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > maxBytes) throw new ImageGenerationError('IMAGE_SIZE_INVALID');
    onProgress?.();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onProgress?.();
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

/** Callers pass the union of adapter `downloadHosts`; see `downloadGeneratedImage` in the catalog. */
export async function downloadImage(url: string, deadline: Date, trustedHosts: readonly string[]): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    const encoded = match?.[1];
    if (!encoded) throw new ImageGenerationError('IMAGE_FORMAT_INVALID');
    if (encoded.length > Math.ceil((IMAGE_LIMITS.maxBytes * 4) / 3) + 4) throw new ImageGenerationError('IMAGE_SIZE_INVALID');
    return Buffer.from(encoded, 'base64');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageGenerationError('IMAGE_URL_INVALID');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    !trustedHosts.some(host => parsed.hostname.endsWith(`.${host}`))
  ) {
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

/** 生成图入库编码：默认 PNG；`jpeg` 时已是标准 sRGB JPEG 的原样保留（只做完整解码校验），其余格式转为 JPEG 95。 */
export type NormalizedOutput = 'png' | 'jpeg';

export async function normalizeGeneratedImage(bytes: Buffer, minLongEdge = 1, minShortEdge = 1, output: NormalizedOutput = 'png') {
  if (!bytes.length || bytes.length > IMAGE_LIMITS.maxBytes) throw new ImageGenerationError('IMAGE_SIZE_INVALID');
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: IMAGE_LIMITS.maxPixels });
    const metadata = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1)
      throw new ImageGenerationError('IMAGE_FORMAT_INVALID');
    const keepJpeg = output === 'jpeg' && metadata.format === 'jpeg' && metadata.space === 'srgb' && (metadata.orientation ?? 1) === 1;
    const encode = () => {
      const normalized = image.rotate().toColourspace('srgb');
      return (output === 'jpeg' ? normalized.flatten({ background: '#FFFFFF' }).jpeg({ quality: 95 }) : normalized.png()).toBuffer({
        resolveWithObject: true,
      });
    };
    const { data, info } = keepJpeg
      ? { data: bytes, info: (await image.raw().toBuffer({ resolveWithObject: true })).info }
      : await encode();
    if (Math.max(info.width, info.height) < minLongEdge || Math.min(info.width, info.height) < minShortEdge)
      throw new ImageGenerationError('IMAGE_RESOLUTION_TOO_LOW');
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

// Recording diagnostics must never change how the provider outcome is classified.
async function observeProviderRequest(observe: ProviderRequestObserver | undefined, headers: Pick<Headers, 'get'>, body: unknown) {
  const requestId = providerRequestId(headers, body);
  if (requestId && observe)
    try {
      await observe(requestId);
    } catch {}
}

export async function imageMimeType(bytes: Buffer): Promise<string> {
  const { format } = await sharp(bytes, { limitInputPixels: IMAGE_LIMITS.maxPixels }).metadata();
  return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
}

/** JSON call to an image provider; `submitting` marks requests whose failure may leave a billable job behind. */
export async function providerJson(
  url: string,
  init: RequestInit,
  deadline: Date,
  submitting: boolean,
  observe?: ProviderRequestObserver,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const abortIn = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), Math.max(1, ms));
  };
  try {
    abortIn(requestTimeout(deadline, submitting ? SUBMIT_HEADERS_TIMEOUT_MS : POLL_TIMEOUT_MS));
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    const bodyEnd = Math.min(Date.now() + BODY_TIMEOUT_MS, deadline.getTime());
    if (!response.ok) {
      await observeProviderRequest(observe, response.headers, undefined);
      await response.body?.cancel().catch(() => {});
      throw new ImageGenerationError(
        response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REQUEST_FAILED',
        response.status === 429 || (!submitting && response.status >= 500),
        submitting && response.status >= 500,
      );
    }
    const bytes = await readBytes(response, Math.ceil((IMAGE_LIMITS.maxBytes * 4) / 3) * 4 + 1024 * 1024, () =>
      abortIn(Math.min(BODY_IDLE_TIMEOUT_MS, bodyEnd - Date.now())),
    );
    const body = JSON.parse(bytes.toString('utf8')) as unknown;
    await observeProviderRequest(observe, response.headers, body);
    return body;
  } catch (error) {
    if (error instanceof ImageGenerationError && error.code.startsWith('PROVIDER_')) throw error;
    throw new ImageGenerationError(submitting ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_POLL_UNAVAILABLE', !submitting, submitting);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves a provider URL under an admin-configured base URL; refusal happens before anything is submitted. */
export async function providerEndpoint(baseUrl: string, path: string): Promise<string> {
  try {
    await assertPublicEndpoint(baseUrl);
  } catch {
    throw new ImageGenerationError('PROVIDER_ENDPOINT_INVALID');
  }
  return `${baseUrl}${path}`;
}
