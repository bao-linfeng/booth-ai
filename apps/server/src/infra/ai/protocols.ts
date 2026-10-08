import { downloadImage, ImageGenerationError } from './image.js';
import { arkImage, arkSuggestedModels } from './providers/ark.js';
import { geminiImage, geminiImageParams, listGeminiModels } from './providers/gemini.js';
import { listOpenAiModels, openAiChat, openAiChatParams, openAiImage, openAiImageParams } from './providers/openai.js';
import { qwenImage, qwenImageSuggestedModels } from './providers/qwen-image.js';
import type { AiPurpose, DiscoveredModel, ImageModelAdapter, ImagePurpose, ModelKind, ModelParams, ParamField,
  ProviderProtocol, TextModelAdapter } from './types.js';

interface Capability<Adapter> {
  adapter: Adapter;
  /** Rendered as the model form by the admin UI and enforced on save. */
  params: ParamField[];
}

export interface ProtocolDefinition {
  id: ProviderProtocol;
  label: string;
  description: string;
  defaultBaseUrl: string;
  /** Lists models with the provider's own credentials; protocols without a listing API offer suggestions instead. */
  listModels?(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]>;
  suggestedModels: DiscoveredModel[];
  text?: Capability<TextModelAdapter>;
  /** `purposes` lists the image purposes the adapter can satisfy; artwork needs >= 1536x1024 output. */
  image?: Capability<ImageModelAdapter> & { purposes: ImagePurpose[] };
}

/**
 * Wire protocols the platform can speak. Providers (base URL + key) and models are configured by admins at runtime;
 * code changes are only needed for a new protocol or a new capability of an existing one.
 */
export const PROTOCOLS: readonly ProtocolDefinition[] = [
  { id: 'openai', label: 'OpenAI 及兼容接口', description: 'OpenAI、DeepSeek、通义千问兼容模式及各类中转服务',
    defaultBaseUrl: 'https://api.openai.com/v1', listModels: listOpenAiModels, suggestedModels: [],
    text: { adapter: openAiChat, params: openAiChatParams },
    image: { adapter: openAiImage, params: openAiImageParams, purposes: ['theme', 'artwork'] } },
  { id: 'gemini', label: 'Google Gemini', description: 'Gemini API（Nano Banana 图像模型）',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', listModels: listGeminiModels, suggestedModels: [],
    image: { adapter: geminiImage, params: geminiImageParams, purposes: ['theme', 'artwork'] } },
  { id: 'qwen-image', label: '阿里云百炼 Qwen-Image / 万相 2.7', description: 'Qwen-Image 与万相 2.7 图像编辑（百炼 multimodal-generation 接口，同步返回）；通义千问文本请用「OpenAI 及兼容接口」+ 兼容模式地址',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1', suggestedModels: qwenImageSuggestedModels,
    image: { adapter: qwenImage, params: [], purposes: ['theme', 'artwork'] } },
  { id: 'ark', label: '火山方舟 Doubao Seedream', description: 'Seedream 图像编辑（images/generations，同步返回）；豆包文本模型请用「OpenAI 及兼容接口」+ 方舟 /api/v3 地址',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', suggestedModels: arkSuggestedModels,
    image: { adapter: arkImage, params: [], purposes: ['theme', 'artwork'] } },
];

export function protocolDefinition(protocol: string): ProtocolDefinition | undefined {
  return PROTOCOLS.find(definition => definition.id === protocol);
}

function capability(protocol: string, kind: ModelKind) {
  const definition = protocolDefinition(protocol);
  return kind === 'text' ? definition?.text : definition?.image;
}

export function supportsKind(protocol: string, kind: ModelKind): boolean {
  return Boolean(capability(protocol, kind));
}

export function supportsPurpose(protocol: string, kind: ModelKind, purpose: AiPurpose): boolean {
  if (purpose === 'selection_parse') return kind === 'text' && supportsKind(protocol, 'text');
  return kind === 'image' && Boolean(protocolDefinition(protocol)?.image?.purposes.includes(purpose));
}

/** Validates admin params against the capability schema and fills defaults; unknown keys are rejected. */
export function normalizeParams(protocol: string, kind: ModelKind, input: Record<string, unknown>): ModelParams {
  const fields = capability(protocol, kind)?.params;
  if (!fields) throw new Error('Unsupported model kind');
  const unknown = Object.keys(input).filter(key => !fields.some(field => field.key === key));
  if (unknown.length) throw new Error('Unknown model parameter');
  return Object.fromEntries(fields.map(field => {
    const value = input[field.key] ?? field.default;
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) throw new Error('Invalid model parameter');
    } else if (typeof value !== 'string' || !field.options.some(option => option.value === value)) throw new Error('Invalid model parameter');
    return [field.key, value];
  }));
}

export function imageAdapter(model: { protocol: string; kind: ModelKind }): ImageModelAdapter {
  const image = model.kind === 'image' ? protocolDefinition(model.protocol)?.image : undefined;
  if (!image) throw new ImageGenerationError('PROVIDER_UNSUPPORTED');
  return image.adapter;
}

export function textAdapter(model: { protocol: string; kind: ModelKind }): TextModelAdapter {
  const text = model.kind === 'text' ? protocolDefinition(model.protocol)?.text : undefined;
  if (!text) throw new Error('Model unavailable');
  return text.adapter;
}

const trustedDownloadHosts = [...new Set(PROTOCOLS.flatMap(definition => definition.image?.adapter.downloadHosts ?? []))];

/** Downloads a provider result; stored URLs are not tied to a model, so every registered image host is trusted. */
export function downloadGeneratedImage(url: string, deadline: Date): Promise<Buffer> {
  return downloadImage(url, deadline, trustedDownloadHosts);
}
