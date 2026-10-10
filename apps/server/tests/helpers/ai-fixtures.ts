import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { encryptCredential } from '../../src/infra/ai/config.js';
import { isTextPurpose, type ActiveAiModel, type AiPurpose, type ModelKind, type ModelParams, type ProviderProtocol } from '../../src/infra/ai/types.js';

export const testEncryptionKey = 'a'.repeat(64);

const defaults: Record<ProviderProtocol, { baseUrl: string; model: Record<ModelKind, string>; params: Record<ModelKind, ModelParams> }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: { text: 'gpt-test', image: 'gpt-image-1.5' },
    params: { text: { temperature: 0, jsonMode: 'on' }, image: { quality: 'auto' } } },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: { text: 'gemini-test', image: 'gemini-3.1-flash-image' },
    params: { text: {}, image: { imageSize: '2K' } } },
  'qwen-image': { baseUrl: 'https://dashscope.aliyuncs.com/api/v1', model: { text: 'qwen-test', image: 'qwen-image-3.0-pro' },
    params: { text: {}, image: {} } },
  ark: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: { text: 'doubao-test', image: 'doubao-seedream-5-0-flash-260915' },
    params: { text: {}, image: {} } },
};

/** An in-memory model as returned by `activeAiModels`, for adapter and worker unit tests. */
export function activeModel(protocol: ProviderProtocol, purpose: AiPurpose, overrides: Partial<ActiveAiModel> = {}): ActiveAiModel {
  const kind: ModelKind = isTextPurpose(purpose) ? 'text' : 'image';
  return { id: randomUUID(), kind, model: defaults[protocol].model[kind], params: defaults[protocol].params[kind],
    revision: 1, purpose, position: 1, unitCredits: isTextPurpose(purpose) ? null : 3, protocol, providerName: protocol,
    baseUrl: defaults[protocol].baseUrl, apiKey: 'secret', ...overrides };
}

/** A row shaped like the assignment query result in `infra/ai/config.ts`, for mocked pools. */
export function assignedRow(protocol: ProviderProtocol, purpose: AiPurpose, overrides: Partial<ActiveAiModel> = {}, encryptionKey = testEncryptionKey) {
  const { apiKey, ...model } = activeModel(protocol, purpose, overrides);
  const credentialScope = `scope-${model.id}`;
  return { ...model, credentialScope, credentialCiphertext: encryptCredential(apiKey, credentialScope, encryptionKey) };
}

/** Inserts provider, model and assignment rows into a real database; returns the model id. */
export async function seedAiModel(pool: Pick<pg.Pool, 'query'>, input: { protocol: ProviderProtocol; purpose: AiPurpose; model?: string;
  unitCredits?: number | null; position?: number; apiKey?: string; encryptionKey?: string }) {
  const kind: ModelKind = isTextPurpose(input.purpose) ? 'text' : 'image';
  const providerId = randomUUID(); const modelId = randomUUID();
  await pool.query(`INSERT INTO ai_providers (id, name, protocol, base_url, credential_ciphertext, credential_scope) VALUES ($1::uuid, $2, $3, $4, $5, $1::text)`,
    [providerId, `provider ${providerId}`, input.protocol, defaults[input.protocol].baseUrl,
      encryptCredential(input.apiKey ?? 'test-key', providerId, input.encryptionKey ?? testEncryptionKey)]);
  await pool.query('INSERT INTO ai_models (id, provider_id, kind, model, params) VALUES ($1, $2, $3, $4, $5)',
    [modelId, providerId, kind, input.model ?? defaults[input.protocol].model[kind], JSON.stringify(defaults[input.protocol].params[kind])]);
  await pool.query('INSERT INTO ai_model_assignments (purpose, model_id, position, unit_credits) VALUES ($1, $2, $3, $4)',
    [input.purpose, modelId, input.position ?? 1, isTextPurpose(input.purpose) ? null : input.unitCredits ?? 3]);
  return modelId;
}
