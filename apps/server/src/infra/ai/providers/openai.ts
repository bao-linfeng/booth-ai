import { assertPublicEndpoint } from '../endpoint.js';
import { fetchModelListing, ModelDiscoveryError } from '../discovery.js';
import { ImageGenerationError, imageMimeType, providerEndpoint, providerJson } from '../image.js';
import type { DiscoveredModel, ImageModelAdapter, ParamField, TextModelAdapter } from '../types.js';

// OpenAI and every service exposing the same REST surface (DeepSeek, DashScope compatible mode, relays).

export const openAiChatParams: ParamField[] = [
  { key: 'temperature', label: '温度', description: '0 表示输出最稳定', type: 'number', default: 0, min: 0, max: 2, step: 0.1 },
  { key: 'jsonMode', label: 'JSON 模式', description: '供应商不支持 response_format 时关闭，仍会在提示词中要求 JSON', type: 'select', default: 'on',
    options: [{ label: '开启', value: 'on' }, { label: '关闭', value: 'off' }] },
];

export const openAiChat: TextModelAdapter = {
  async complete(model, { messages, maxTokens, json, signal }) {
    await assertPublicEndpoint(model.baseUrl);
    const response = await fetch(`${model.baseUrl}/chat/completions`, {
      method: 'POST', signal, redirect: 'error',
      headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.model, temperature: Number(model.params.temperature ?? 0), max_tokens: maxTokens,
        ...(json && model.params.jsonMode !== 'off' ? { response_format: { type: 'json_object' } } : {}), messages }),
    });
    if (!response.ok) throw new Error('Model unavailable');
    const payload: unknown = await response.json();
    const content = (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Invalid model response');
    return content;
  },
};

export const openAiImageParams: ParamField[] = [
  { key: 'quality', label: '换主题画质', description: '四面素材固定使用 high 以满足 1536×1024 交付标准', type: 'select', default: 'auto',
    options: ['auto', 'low', 'medium', 'high'].map(value => ({ label: value, value })) },
];

// https://platform.openai.com/docs/api-reference/images/createEdit
export const openAiImage: ImageModelAdapter = {
  maxImagesPerRequest: 10,
  downloadHosts: ['openai.com', 'blob.core.windows.net'],
  async edit(model, { reference, prompt, count, deadline, mask, onProviderRequest }) {
    const url = await providerEndpoint(model.baseUrl, '/images/edits');
    const artwork = model.purpose === 'artwork';
    const quality = artwork ? 'high' : String(model.params.quality ?? 'auto');
    const form = new FormData();
    form.set('model', model.model);
    form.set('image', new Blob([new Uint8Array(reference)], { type: await imageMimeType(reference) }), 'source.png');
    form.set('prompt', prompt);
    form.set('n', String(count));
    form.set('size', artwork ? '1536x1024' : '1792x1024');
    if (quality !== 'auto') form.set('quality', quality);
    if (artwork) form.set('output_format', 'png');
    if (mask) form.set('mask', new Blob([new Uint8Array(mask)], { type: 'image/png' }), 'mask.png');
    const body = await providerJson(url, {
      method: 'POST', headers: { Authorization: `Bearer ${model.apiKey}` }, body: form,
    }, deadline, true, onProviderRequest) as { data?: { b64_json?: string; url?: string }[] };
    if (!Array.isArray(body?.data)) throw new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
    return body.data.flatMap(item => typeof item?.b64_json === 'string' && item.b64_json ? [`data:image/png;base64,${item.b64_json}`] :
      typeof item?.url === 'string' && item.url ? [item.url] : []);
  },
};

const NON_GENERATIVE = /(embed|tts|whisper|moderation|transcribe|audio|realtime|search|rerank)/i;

export async function listOpenAiModels(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const body = await fetchModelListing(baseUrl, '/models', { Authorization: `Bearer ${apiKey}` }) as { data?: { id?: unknown }[] };
  if (!Array.isArray(body?.data)) throw new ModelDiscoveryError('BAD_RESPONSE');
  return body.data.flatMap(item => typeof item?.id === 'string' && item.id ? [{ id: item.id,
    ...(/(image|dall-e)/i.test(item.id) ? { kind: 'image' as const } : NON_GENERATIVE.test(item.id) ? {} : { kind: 'text' as const }) }] : []);
}
