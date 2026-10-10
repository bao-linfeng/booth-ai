import sharp from 'sharp';
import { IMAGE_LIMITS, ImageGenerationError, imageMimeType, providerEndpoint, providerJson } from '../image.js';
import type { DiscoveredModel, ImageModelAdapter } from '../types.js';

// Qwen-Image and Wan 2.7 on Alibaba Cloud Model Studio (百炼): both share the synchronous multimodal-generation API.
// Inputs are capped at 3072px per edge and about 10 MB, so larger references are re-encoded first.
const MAX_REFERENCE_EDGE = 3072;
const INLINE_REFERENCE_BYTES = 7 * 1024 * 1024;
// 2048x1152 is strict 16:9 and clears the artwork quality gate; Qwen-Image takes `width*height`.
const OUTPUT_SIZE = '2048*1152';

type QwenImageResponse = { output?: { choices?: { message?: { content?: { image?: string }[] } }[] } };

async function referenceDataUrl(reference: Buffer): Promise<string> {
  const { width = 0, height = 0 } = await sharp(reference, { limitInputPixels: IMAGE_LIMITS.maxPixels }).metadata();
  if (reference.length <= INLINE_REFERENCE_BYTES && Math.max(width, height) <= MAX_REFERENCE_EDGE) {
    return `data:${await imageMimeType(reference)};base64,${reference.toString('base64')}`;
  }
  const resized = await sharp(reference, { limitInputPixels: IMAGE_LIMITS.maxPixels })
    .rotate()
    .resize({ width: MAX_REFERENCE_EDGE, height: MAX_REFERENCE_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return `data:image/jpeg;base64,${resized.toString('base64')}`;
}

// https://help.aliyun.com/zh/model-studio/qwen-image-edit-api and
// https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference — the mask is ignored;
// edits are described in the prompt. Wan 2.7 caps `n` at 4, which theme jobs never exceed.
export const qwenImage: ImageModelAdapter = {
  maxImagesPerRequest: 6,
  downloadHosts: ['aliyuncs.com'],
  async edit(model, { reference, prompt, count, deadline, onProviderRequest }) {
    const url = await providerEndpoint(model.baseUrl, '/services/aigc/multimodal-generation/generation');
    const body = (await providerJson(
      url,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.model,
          input: { messages: [{ role: 'user', content: [{ image: await referenceDataUrl(reference) }, { text: prompt }] }] },
          parameters: { n: count, size: OUTPUT_SIZE, prompt_extend: false, watermark: false },
        }),
      },
      deadline,
      true,
      onProviderRequest,
    )) as QwenImageResponse;
    if (!Array.isArray(body?.output?.choices)) throw new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
    const images = body.output.choices.flatMap(choice =>
      (Array.isArray(choice?.message?.content) ? choice.message.content : []).flatMap(part =>
        typeof part?.image === 'string' && part.image ? [part.image] : [],
      ),
    );
    if (!images.length) throw new ImageGenerationError('PROVIDER_NO_IMAGE');
    return images;
  },
};

// The native API has no model listing endpoint; admins pick a suggestion or type a model id.
export const qwenImageSuggestedModels: DiscoveredModel[] = [
  { id: 'qwen-image-3.0-pro', name: 'Qwen-Image 3.0 Pro', kind: 'image' },
  { id: 'qwen-image-3.0', name: 'Qwen-Image 3.0', kind: 'image' },
  { id: 'wan2.7-image-pro', name: '万相 2.7 Image Pro', kind: 'image' },
  { id: 'wan2.7-image', name: '万相 2.7 Image', kind: 'image' },
];
