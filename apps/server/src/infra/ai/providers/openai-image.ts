import { ImageGenerationError, imageMimeType, providerJson } from '../image.js';
import type { ImageModelAdapter } from '../types.js';

// https://platform.openai.com/docs/api-reference/images/createEdit
export const openAiImage: ImageModelAdapter = {
  maxImagesPerRequest: 10,
  downloadHosts: ['openai.com', 'blob.core.windows.net'],
  async edit(model, { reference, prompt, count, deadline, mask, onProviderRequest }) {
    const artwork = model.purpose === 'artwork';
    const form = new FormData();
    form.set('model', model.model);
    form.set('image', new Blob([new Uint8Array(reference)], { type: await imageMimeType(reference) }), 'source.png');
    form.set('prompt', prompt);
    form.set('n', String(count));
    form.set('size', artwork ? '1536x1024' : '1792x1024');
    if (artwork) { form.set('quality', 'high'); form.set('output_format', 'png'); }
    if (mask) form.set('mask', new Blob([new Uint8Array(mask)], { type: 'image/png' }), 'mask.png');
    const body = await providerJson('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${model.apiKey}` }, body: form,
    }, deadline, true, onProviderRequest) as { data?: { b64_json?: string; url?: string }[] };
    if (!Array.isArray(body?.data)) throw new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
    return body.data.flatMap(item => typeof item?.b64_json === 'string' && item.b64_json ? [`data:image/png;base64,${item.b64_json}`] :
      typeof item?.url === 'string' && item.url ? [item.url] : []);
  },
};
