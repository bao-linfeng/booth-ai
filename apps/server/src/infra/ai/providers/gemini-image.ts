import sharp from 'sharp';
import { IMAGE_LIMITS, ImageGenerationError, imageMimeType, providerJson } from '../image.js';
import type { ImageModelAdapter } from '../types.js';

// Gemini image models: https://ai.google.dev/gemini-api/docs/image-generation (generateContent stays fully supported).
const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
// Inline request data is capped at 20 MB; base64 inflates by 4/3, so larger references are re-encoded first.
const INLINE_REFERENCE_BYTES = 14 * 1024 * 1024;
const BLOCKED_FINISH_REASONS = ['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_RECITATION'];

type GeminiResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { thought?: boolean; inlineData?: { mimeType?: string; data?: string } }[] } }[];
};

export function geminiAspectRatio(width: number | undefined, height: number | undefined): string {
  if (!width || !height) return '16:9';
  const target = Math.log(width / height);
  const distance = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return Math.abs(Math.log(w! / h!) - target); };
  return ASPECT_RATIOS.reduce((best, ratio) => distance(ratio) < distance(best) ? ratio : best);
}

// One image per call; Gemini has no hard mask parameter, so the mask is ignored.
export const geminiImage: ImageModelAdapter = {
  maxImagesPerRequest: 1,
  downloadHosts: ['googleusercontent.com'],
  async edit(model, { reference, prompt, deadline, onProviderRequest }) {
    const metadata = await sharp(reference, { limitInputPixels: IMAGE_LIMITS.maxPixels }).metadata();
    let input = { data: reference, mimeType: await imageMimeType(reference) };
    if (reference.length > INLINE_REFERENCE_BYTES) {
      input = { mimeType: 'image/jpeg', data: await sharp(reference, { limitInputPixels: IMAGE_LIMITS.maxPixels }).rotate()
        .resize({ width: 3072, height: 3072, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer() };
    }
    const [width, height] = (metadata.orientation ?? 1) >= 5 ? [metadata.height, metadata.width] : [metadata.width, metadata.height];
    const body = await providerJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': model.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: input.mimeType, data: input.data.toString('base64') } }] }],
        // 2K is the smallest size whose 3:2 output clears the 1536x1024 artwork quality gate.
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: {
          aspectRatio: model.purpose === 'artwork' ? '3:2' : geminiAspectRatio(width, height), imageSize: '2K' } },
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
