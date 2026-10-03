import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { supportsPurpose } from './protocols.js';
import type { ActiveAiModel, AiPurpose, AssignedAiModel, ModelKind, ModelParams, ProviderProtocol } from './types.js';

/** `scope` is AES-GCM associated data binding the ciphertext to one provider row. */
export function encryptCredential(value: string, scope: string, encryptionKey: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  cipher.setAAD(Buffer.from(scope));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptCredential(value: Buffer, scope: string, encryptionKey: string): string {
  if (value.length < 29) throw new Error('Invalid model credential');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), value.subarray(0, 12));
  decipher.setAAD(Buffer.from(scope));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
}

interface AssignedRow {
  id: string; name: string; kind: ModelKind; model: string; params: ModelParams; revision: number;
  purpose: AiPurpose; position: number; unitCredits: number | null;
  protocol: ProviderProtocol; providerName: string; baseUrl: string;
  credentialCiphertext: Buffer; credentialScope: string;
}

// Usable = assigned, model and provider enabled, provider holds a key, and the protocol supports the purpose.
const assignedQuery = `SELECT m.id, m.name, m.kind, m.model, m.params, m.revision, a.purpose, a.position, a.unit_credits AS "unitCredits",
    p.protocol, p.name AS "providerName", p.base_url AS "baseUrl", p.credential_ciphertext AS "credentialCiphertext",
    p.credential_scope AS "credentialScope"
  FROM ai_model_assignments a
  JOIN ai_models m ON m.id = a.model_id
  JOIN ai_providers p ON p.id = m.provider_id
  WHERE a.purpose = $1 AND m.enabled AND p.enabled AND p.credential_ciphertext IS NOT NULL
  ORDER BY a.position`;

async function assignedRows(pool: Pick<pg.Pool, 'query'>, purpose: AiPurpose) {
  return (await pool.query<AssignedRow>(assignedQuery, [purpose])).rows.filter(row => supportsPurpose(row.protocol, row.kind, row.purpose) &&
    (purpose === 'selection_parse' || row.unitCredits !== null));
}

/** Usable models for a purpose in primary-first order, without secrets. */
export async function assignedAiModels(pool: Pick<pg.Pool, 'query'>, purpose: AiPurpose): Promise<AssignedAiModel[]> {
  return (await assignedRows(pool, purpose)).map(({ baseUrl: _baseUrl, credentialCiphertext: _ciphertext, credentialScope: _scope, ...model }) => model);
}

/** Usable models with decrypted credentials, for the process that is about to call the provider. */
export async function activeAiModels(pool: Pick<pg.Pool, 'query'>, purpose: AiPurpose, encryptionKey: string): Promise<ActiveAiModel[]> {
  return (await assignedRows(pool, purpose)).map(({ credentialCiphertext, credentialScope, ...model }) => ({
    ...model, apiKey: decryptCredential(credentialCiphertext, credentialScope, encryptionKey),
  }));
}
