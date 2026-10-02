import { downloadImage, ImageGenerationError } from './image.js';
import { geminiImage } from './providers/gemini-image.js';
import { openAiCompatibleChat } from './providers/openai-compatible-chat.js';
import { openAiImage } from './providers/openai-image.js';
import { wanxImage } from './providers/wanx-image.js';
import type { ActiveAiModel, AiPurpose, AiProvider, ImageModelAdapter, ImagePurpose, TextModelAdapter } from './types.js';

interface ModelDefinitionBase {
  provider: AiProvider;
  /** Model id sent to the provider; part of job snapshots, so changing it strands in-flight jobs. */
  model: string;
  /** Display name for admin and client pickers. */
  label: string;
}
export type TextModelDefinition = ModelDefinitionBase & { purpose: 'selection_parse'; adapter: TextModelAdapter };
export type ImageModelDefinition = ModelDefinitionBase & { purpose: ImagePurpose; adapter: ImageModelAdapter };
export type AiModelDefinition = TextModelDefinition | ImageModelDefinition;

/**
 * Every model the platform can call. To onboard a model, add an adapter under `providers/` (or reuse one)
 * and register a (purpose, provider) entry here; admin configuration rows are created on first save.
 * Credentials are stored per (purpose, provider) and encrypted with the provider id as associated data.
 */
export const AI_MODELS: readonly AiModelDefinition[] = [
  { purpose: 'selection_parse', provider: 'qwen', label: '通义千问', model: 'qwen-plus',
    adapter: openAiCompatibleChat('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions') },
  { purpose: 'selection_parse', provider: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-flash',
    adapter: openAiCompatibleChat('https://api.deepseek.com/chat/completions') },
  { purpose: 'theme', provider: 'gemini', label: 'Gemini Nano Banana', model: 'gemini-3.1-flash-image', adapter: geminiImage },
  { purpose: 'theme', provider: 'wanx', label: '通义万相', model: 'wanx2.1-imageedit', adapter: wanxImage },
  { purpose: 'theme', provider: 'openai', label: 'GPT Image (OpenAI)', model: 'gpt-image-2.5-sunburst', adapter: openAiImage },
  // Artwork must reach 1536x1024; only adapters that can request that resolution belong here.
  { purpose: 'artwork', provider: 'openai', label: 'GPT Image (OpenAI)', model: 'gpt-image-1.5', adapter: openAiImage },
  { purpose: 'artwork', provider: 'gemini', label: 'Gemini Nano Banana', model: 'gemini-3.1-flash-image', adapter: geminiImage },
];

export const AI_PROVIDERS: readonly AiProvider[] = [...new Set(AI_MODELS.map(definition => definition.provider))];

export function findModelDefinition(purpose: AiPurpose, provider: AiProvider): AiModelDefinition | undefined {
  return AI_MODELS.find(definition => definition.purpose === purpose && definition.provider === provider);
}

export function imageAdapter(model: Pick<ActiveAiModel, 'purpose' | 'provider'>): ImageModelAdapter {
  const definition = findModelDefinition(model.purpose, model.provider);
  if (!definition || definition.purpose === 'selection_parse') throw new ImageGenerationError('PROVIDER_UNSUPPORTED');
  return definition.adapter;
}

export function textAdapter(model: Pick<ActiveAiModel, 'purpose' | 'provider'>): TextModelAdapter {
  const definition = findModelDefinition(model.purpose, model.provider);
  if (definition?.purpose !== 'selection_parse') throw new Error('Model unavailable');
  return definition.adapter;
}

const trustedDownloadHosts = [...new Set(AI_MODELS.flatMap(definition => definition.purpose === 'selection_parse' ? [] : definition.adapter.downloadHosts))];

/** Downloads a provider result; stored URLs are not tied to a model, so every registered image host is trusted. */
export function downloadGeneratedImage(url: string, deadline: Date): Promise<Buffer> {
  return downloadImage(url, deadline, trustedDownloadHosts);
}
