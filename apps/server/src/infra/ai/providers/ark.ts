import sharp from 'sharp';
import { IMAGE_LIMITS, ImageGenerationError, imageMimeType, providerEndpoint, providerJson } from '../image.js';
import type { DiscoveredModel, ImageModelAdapter } from '../types.js';

// Volcano Engine Ark (火山方舟) Doubao Seedream: synchronous images/generations with the reference image inlined.
// References may reach 30 MB / 36 MP, but a smaller inline payload keeps the JSON request well below gateway limits.
const MAX_REFERENCE_EDGE = 4096;
const INLINE_REFERENCE_BYTES = 10 * 1024 * 1024;
// Strict 16:9 at 3,686,400 px: the only size inside every Seedream range (5.0 pro/flash cap 4,624,220 px,
// 5.0 lite and 4.5 require at least 3,686,400 px) and above the artwork quality gate.
const OUTPUT_SIZE = '2560x1440';

type ArkImageResponse = { data?: { b64_json?: string; output_format?: string; error?: { code?: string } }[] };

async function referenceDataUrl(reference: Buffer): Promise<string> {
  const { width = 0, height = 0 } = await sharp(reference, { limitInputPixels: IMAGE_LIMITS.maxPixels }).metadata();
  if (reference.length <= INLINE_REFERENCE_BYTES && Math.max(width, height) <= MAX_REFERENCE_EDGE) {
    return `data:${await imageMimeType(reference)};base64,${reference.toString('base64')}`;
  }
  const resized = await sharp(reference, { limitInputPixels: IMAGE_LIMITS.maxPixels }).rotate()
    .resize({ width: MAX_REFERENCE_EDGE, height: MAX_REFERENCE_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${resized.toString('base64')}`;
}

// https://www.volcengine.com/docs/82379/1541523 — one image per call (5.0 pro/flash reject group generation);
// the mask is ignored and edits are described in the prompt. Base64 results avoid the 24-hour TOS download links.
export const arkImage: ImageModelAdapter = {
  maxImagesPerRequest: 1,
  downloadHosts: [],
  async edit(model, { reference, prompt, deadline, onProviderRequest }) {
    const url = await providerEndpoint(model.baseUrl, '/images/generations');
    const body = await providerJson(url, {
      method: 'POST', headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.model, prompt, image: await referenceDataUrl(reference), size: OUTPUT_SIZE,
        response_format: 'b64_json', watermark: false, stream: false }),
    }, deadline, true, onProviderRequest) as ArkImageResponse;
    if (!Array.isArray(body?.data)) throw new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
    const images = body.data.flatMap(item => typeof item?.b64_json === 'string' && item.b64_json
      ? [`data:image/${item.output_format === 'png' ? 'png' : 'jpeg'};base64,${item.b64_json}`] : []);
    if (images.length) return images;
    throw new ImageGenerationError(body.data.some(item => /SensitiveContent/i.test(String(item?.error?.code ?? '')))
      ? 'PROVIDER_CONTENT_BLOCKED' : 'PROVIDER_NO_IMAGE');
  },
};

// Model listing is not part of the API-key surface used here; admins pick a suggestion or type a model / endpoint id.
export const arkSuggestedModels: DiscoveredModel[] = [
  { id: 'doubao-seedream-5-0-pro-260628', name: 'Doubao Seedream 5.0 Pro', kind: 'image' },
  { id: 'doubao-seedream-5-0-flash-260915', name: 'Doubao Seedream 5.0 Flash', kind: 'image' },
  { id: 'doubao-seedream-5-0-lite-260128', name: 'Doubao Seedream 5.0 Lite', kind: 'image' },
  { id: 'doubao-seedream-4-5-251128', name: 'Doubao Seedream 4.5', kind: 'image' },
  { id: 'doubao-seedream-4-0-250828', name: 'Doubao Seedream 4.0', kind: 'image' },
];
