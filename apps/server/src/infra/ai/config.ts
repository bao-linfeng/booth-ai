import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { AI_MODELS } from './catalog.js';
import type { ActiveAiModel, AiModelConfig, AiProvider, AiPurpose } from './types.js';

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

const query = 'SELECT purpose, provider, enabled, priority, unit_credits AS "unitCredits", revision, credential_ciphertext AS "credentialCiphertext" FROM ai_model_configs';

// Catalog entries without a stored row are listed with column defaults; the row is created on first save.
async function catalogRows(pool: Pick<pg.Pool, 'query'>) {
  const rows = (await pool.query<AiModelRow>(query)).rows;
  return AI_MODELS.map(({ purpose, provider, model, label }) => {
    const row = rows.find(stored => stored.purpose === purpose && stored.provider === provider) ??
      { purpose, provider, enabled: false, priority: 0, unitCredits: null, revision: 1, credentialCiphertext: null };
    return { ...row, model, label };
  });
}

export async function listAiModels(pool: Pick<pg.Pool, 'query'>): Promise<AiModelConfig[]> {
  return (await catalogRows(pool)).map(({ credentialCiphertext, ...row }) => ({ ...row, credentialConfigured: credentialCiphertext !== null }));
}

export async function activeAiModels(pool: Pick<pg.Pool, 'query'>, purpose: AiPurpose, encryptionKey: string): Promise<ActiveAiModel[]> {
  return (await catalogRows(pool)).filter(row => row.purpose === purpose && row.enabled && row.credentialCiphertext !== null &&
    (purpose === 'selection_parse' || row.unitCredits !== null)).map(({ credentialCiphertext, ...row }) => ({
    ...row, credentialConfigured: true, apiKey: decryptCredential(credentialCiphertext!, row.provider, encryptionKey),
  })).sort((a, b) => a.priority - b.priority);
}
