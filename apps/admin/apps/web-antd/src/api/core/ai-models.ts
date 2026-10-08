import { requestClient } from '#/api/request';

export type AiPurpose =
  | 'artwork'
  | 'cs_translation'
  | 'selection_parse'
  | 'theme';

/** 文本用途调用文本模型且不计积分，与服务端 TEXT_PURPOSES 一致 */
export const TEXT_PURPOSES: readonly AiPurpose[] = [
  'selection_parse',
  'cs_translation',
];
export function isTextPurpose(purpose: AiPurpose): boolean {
  return TEXT_PURPOSES.includes(purpose);
}
export type ModelKind = 'image' | 'text';
export type ModelParams = Record<string, number | string>;

export type ParamField =
  | {
      default: number;
      description?: string;
      key: string;
      label: string;
      max: number;
      min: number;
      step?: number;
      type: 'number';
    }
  | {
      default: string;
      description?: string;
      key: string;
      label: string;
      options: { label: string; value: string }[];
      type: 'select';
    };

export interface DiscoveredModel {
  id: string;
  kind?: ModelKind;
  name?: string;
}

/** Wire protocol implemented by the server; defines model kinds, parameter forms and purposes. */
export interface AiProtocol {
  id: string;
  label: string;
  description: string;
  defaultBaseUrl: string;
  discoverable: boolean;
  suggestedModels: DiscoveredModel[];
  kinds: { kind: ModelKind; params: ParamField[]; purposes: AiPurpose[] }[];
}

export interface AiModelRecord {
  id: string;
  providerId: string;
  kind: ModelKind;
  model: string;
  params: ModelParams;
  enabled: boolean;
  revision: number;
  purposes: AiPurpose[];
}

export interface AiProviderRecord {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  credentialConfigured: boolean;
  enabled: boolean;
  revision: number;
  /** Last listing saved by「刷新模型」; empty until the first refresh or after the Base URL changes. */
  modelCatalog: DiscoveredModel[];
  catalogRefreshedAt: null | string;
  models: AiModelRecord[];
}

export interface AssignmentItem {
  modelId: string;
  unitCredits: null | number;
}

export interface PurposeAssignment {
  purpose: AiPurpose;
  version: string;
  items: AssignmentItem[];
}

export interface ProviderInput {
  name: string;
  baseUrl?: null | string;
  /** Omit to keep the stored key, `null` to clear it. */
  apiKey?: null | string;
  enabled: boolean;
}

export interface ModelInput {
  model: string;
  params: ModelParams;
  enabled: boolean;
}

export function getAiProtocolsApi() {
  return requestClient.get<AiProtocol[]>('/v1/admin/ai-protocols');
}

export function getAiProvidersApi() {
  return requestClient.get<AiProviderRecord[]>('/v1/admin/ai-providers');
}

export function createAiProviderApi(
  input: ProviderInput & { protocol: string },
) {
  return requestClient.post<{ id: string }>('/v1/admin/ai-providers', input);
}

export function updateAiProviderApi(
  id: string,
  input: ProviderInput & { expectedRevision: number },
) {
  return requestClient.put(`/v1/admin/ai-providers/${id}`, input);
}

export function deleteAiProviderApi(id: string) {
  return requestClient.delete(`/v1/admin/ai-providers/${id}`);
}

/** Lists models with the saved base URL and key and stores them as the provider's catalog. */
export function refreshAiProviderCatalogApi(id: string) {
  return requestClient.post<{ models: DiscoveredModel[]; refreshedAt: string }>(
    `/v1/admin/ai-providers/${id}/catalog/refresh`,
    undefined,
    { timeout: 70_000 },
  );
}

/** Tests unsaved form values; nothing is stored. */
export function probeAiProviderApi(input: {
  apiKey: string;
  baseUrl?: null | string;
  protocol: string;
}) {
  return requestClient.post<DiscoveredModel[]>(
    '/v1/admin/ai-providers/probe',
    input,
    { timeout: 70_000 },
  );
}

export function createAiModelApi(
  input: ModelInput & { kind: ModelKind; providerId: string },
) {
  return requestClient.post<{ id: string }>('/v1/admin/ai-models', input);
}

export function updateAiModelApi(
  id: string,
  input: ModelInput & { expectedRevision: number },
) {
  return requestClient.put(`/v1/admin/ai-models/${id}`, input);
}

export function deleteAiModelApi(id: string) {
  return requestClient.delete(`/v1/admin/ai-models/${id}`);
}

export function getAiModelAssignmentsApi() {
  return requestClient.get<PurposeAssignment[]>(
    '/v1/admin/ai-model-assignments',
  );
}

export function saveAiModelAssignmentsApi(
  purpose: AiPurpose,
  input: { expectedVersion: string; items: AssignmentItem[] },
) {
  return requestClient.put<PurposeAssignment>(
    `/v1/admin/ai-model-assignments/${purpose}`,
    input,
  );
}

export const PURPOSE_LABELS: Record<AiPurpose, string> = {
  selection_parse: 'AI 智选 · 需求解析',
  theme: 'AI 换主题',
  artwork: '四面平面素材',
  cs_translation: '在线客服 · 消息翻译',
};

export const KIND_LABELS: Record<ModelKind, string> = {
  text: '文本',
  image: '图像',
};
