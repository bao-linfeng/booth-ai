import sharp from 'sharp';
import { fetchModelListing, ModelDiscoveryError } from '../discovery.js';
import { IMAGE_LIMITS, ImageGenerationError, OUTPUT_ASPECT, imageMimeType, providerEndpoint, providerJson } from '../image.js';
import type { DiscoveredModel, ImageModelAdapter, ParamField } from '../types.js';

// Gemini image models: https://ai.google.dev/gemini-api/docs/image-generation (generateContent stays fully supported).
// Inline request data is capped at 20 MB; base64 inflates by 4/3, so larger references are re-encoded first.
const INLINE_REFERENCE_BYTES = 14 * 1024 * 1024;
const BLOCKED_FINISH_REASONS = ['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_RECITATION'];

type GeminiResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { thought?: boolean; inlineData?: { mimeType?: string; data?: string } }[] } }[];
};

// 1K is omitted: its 16:9 output (about 1376x768) misses the artwork quality gate (short edge >= 1024).
export const geminiImageParams: ParamField[] = [
  { key: 'imageSize', label: '输出分辨率', type: 'select', default: '2K', options: [{ label: '2K', value: '2K' }, { label: '4K', value: '4K' }] },
];

// One image per call; Gemini has no hard mask parameter, so the mask is ignored.
export const geminiImage: ImageModelAdapter = {
  maxImagesPerRequest: 1,
  downloadHosts: ['googleusercontent.com'],
  async edit(model, { reference, prompt, deadline, onProviderRequest }) {
    const url = await providerEndpoint(model.baseUrl, `/models/${encodeURIComponent(model.model)}:generateContent`);
    let input = { data: reference, mimeType: await imageMimeType(reference) };
    if (reference.length > INLINE_REFERENCE_BYTES) {
      input = { mimeType: 'image/jpeg', data: await sharp(reference, { limitInputPixels: IMAGE_LIMITS.maxPixels }).rotate()
        .resize({ width: 3072, height: 3072, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer() };
    }
    const body = await providerJson(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': model.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: input.mimeType, data: input.data.toString('base64') } }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: {
          aspectRatio: OUTPUT_ASPECT.label, imageSize: String(model.params.imageSize ?? '2K') } },
      }),
    }, deadline, true, onProviderRequest) as GeminiResponse;
    if (body?.promptFeedback?.blockReason) throw new ImageGenerationError('PROVIDER_CONTENT_BLOCKED');
    if (!Array.isArray(body?.candidates)) throw new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
    // Thinking models may emit interim draft images marked `thought`; only final images are results.
    const images = body.candidates.flatMap(candidate => (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []).flatMap(part =>
      !part?.thought && typeof part?.inlineData?.data === 'string' && part.inlineData.data
        ? [`data:${['image/jpeg', 'image/webp'].includes(part.inlineData.mimeType ?? '') ? part.inlineData.mimeType : 'image/png'};base64,${part.inlineData.data}`] : []));
    if (images.length) return images;
    throw new ImageGenerationError(body.candidates.some(candidate => BLOCKED_FINISH_REASONS.includes(candidate?.finishReason ?? ''))
      ? 'PROVIDER_CONTENT_BLOCKED' : 'PROVIDER_NO_IMAGE');
  },
};

export async function listGeminiModels(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const body = await fetchModelListing(baseUrl, '/models?pageSize=1000', { 'x-goog-api-key': apiKey }) as
    { models?: { name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }[] };
  if (!Array.isArray(body?.models)) throw new ModelDiscoveryError('BAD_RESPONSE');
  return body.models.flatMap(item => {
    const id = typeof item?.name === 'string' ? item.name.replace(/^models\//, '') : '';
    if (!id || !Array.isArray(item.supportedGenerationMethods) || !item.supportedGenerationMethods.includes('generateContent')) return [];
    return [{ id, ...(typeof item.displayName === 'string' ? { name: item.displayName } : {}), kind: /image/i.test(id) ? 'image' as const : 'text' as const }];
  });
}
