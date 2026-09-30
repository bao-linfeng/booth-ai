import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';

export type AiProvider = 'qwen' | 'deepseek' | 'gemini' | 'wanx' | 'openai';
export type AiPurpose = 'selection_parse' | 'theme' | 'artwork';

export const modelDefinitions = {
  qwen: { purpose: 'selection_parse', model: 'qwen-plus' },
  deepseek: { purpose: 'selection_parse', model: 'deepseek-v4-flash' },
  gemini: { purpose: 'theme', model: 'gemini-2.5-flash-image' },
  wanx: { purpose: 'theme', model: 'wanx2.1-imageedit' },
  openai: { purpose: 'theme', model: 'gpt-image-2.5-sunburst' },
} as const;

export interface AiModelConfig {
  purpose: AiPurpose;
  provider: AiProvider;
  model: string;
  credentialConfigured: boolean;
  enabled: boolean;
  priority: number;
  unitCredits: number | null;
  revision: number;
}

export interface ActiveAiModel extends AiModelConfig {
  apiKey: string;
}

interface AiModelRow {
  purpose: AiPurpose;
  provider: AiProvider;
  enabled: boolean;
  priority: number;
  unitCredits: number | null;
  revision: number;
  credentialCiphertext: Buffer | null;
}

export function encryptCredential(value: string, provider: AiProvider, encryptionKey: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  cipher.setAAD(Buffer.from(provider));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptCredential(value: Buffer, provider: AiProvider, encryptionKey: string): string {
  if (value.length < 29) throw new Error('Invalid model credential');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), value.subarray(0, 12));
  decipher.setAAD(Buffer.from(provider));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
}

const query = 'SELECT purpose, provider, enabled, priority, unit_credits AS "unitCredits", revision, credential_ciphertext AS "credentialCiphertext" FROM ai_model_configs ORDER BY purpose, provider';

export async function listAiModels(pool: pg.Pool): Promise<AiModelConfig[]> {
  const result = await pool.query<AiModelRow>(query);
  return result.rows.map(({ credentialCiphertext, ...row }) => ({ ...row, model: modelDefinitions[row.provider].model,
    credentialConfigured: credentialCiphertext !== null }));
}

export async function activeAiModels(pool: pg.Pool, purpose: AiPurpose, encryptionKey: string): Promise<ActiveAiModel[]> {
  const result = await pool.query<AiModelRow>(query);
  return result.rows.filter(row => row.purpose === purpose && row.enabled && row.credentialCiphertext !== null &&
    (purpose !== 'theme' || row.unitCredits !== null)).map(row => {
    const { credentialCiphertext, ...config } = row;
    return { ...config, model: modelDefinitions[row.provider].model, credentialConfigured: true,
      apiKey: decryptCredential(credentialCiphertext!, row.provider, encryptionKey) };
  }).sort((a, b) => a.priority - b.priority);
}
