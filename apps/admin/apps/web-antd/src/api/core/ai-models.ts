import { requestClient } from '#/api/request';

export interface AiModelRecord {
  purpose: 'selection_parse' | 'theme';
  provider: 'qwen' | 'deepseek' | 'gemini' | 'wanx' | 'openai';
  model: string;
  credentialConfigured: boolean;
  enabled: boolean;
  priority: number;
  unitCredits: null | number;
  revision: number;
}

export function getAiModelsApi() {
  return requestClient.get<AiModelRecord[]>('/v1/admin/ai-models');
}

export function updateAiModelApi(provider: AiModelRecord['provider'], input: Pick<AiModelRecord, 'enabled' | 'priority' | 'unitCredits'> & { expectedRevision: number; apiKey?: null | string }) {
  return requestClient.put<AiModelRecord>(`/v1/admin/ai-models/${provider}`, input);
}
