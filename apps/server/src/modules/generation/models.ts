import type pg from 'pg';
import { encryptCredential, listAiModels, modelDefinitions, type AiProvider, type AiPurpose } from '../../infra/ai-models.js';
import { writeAuditLog } from '../../infra/audit.js';

export interface ModelUpdate {
  purpose: AiPurpose;
  enabled: boolean;
  priority: number;
  unitCredits: number | null;
  expectedRevision: number;
  apiKey?: string | null;
}

export async function updateAiModel(pool: pg.Pool, provider: AiProvider, input: ModelUpdate, adminId: string, encryptionKey: string) {
  const { enabled, priority, unitCredits, expectedRevision, apiKey, purpose } = input;
  if ((purpose === 'selection_parse') !== (modelDefinitions[provider].purpose === 'selection_parse') ||
    (purpose === 'artwork' && provider !== 'openai') ||
    (enabled && purpose === 'selection_parse' && priority === 0) || (purpose !== 'selection_parse' && priority !== 0) ||
    (purpose !== 'selection_parse' && enabled && unitCredits === null) || (purpose === 'selection_parse' && unitCredits !== null) ||
    (apiKey !== undefined && apiKey !== null && (!apiKey.trim() || apiKey !== apiKey.trim()))) {
    throw Object.assign(new Error('Invalid model configuration'), { statusCode: 400 });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ configured: boolean; revision: number }>(
      'SELECT credential_ciphertext IS NOT NULL AS configured, revision FROM ai_model_configs WHERE provider=$1 AND purpose=$2 FOR UPDATE', [provider, purpose]);
    if (current.rows[0]?.revision !== expectedRevision) throw Object.assign(new Error('Model configuration changed'), { statusCode: 409 });
    if (enabled && (apiKey === null || (apiKey === undefined && !current.rows[0]?.configured))) {
      throw Object.assign(new Error('Model credential required'), { statusCode: 400 });
    }
    const credential = apiKey === undefined ? undefined : apiKey === null ? null : encryptCredential(apiKey, provider, encryptionKey);
    await client.query(
      `UPDATE ai_model_configs SET enabled=$1, priority=$2, unit_credits=$3,
       credential_ciphertext=CASE WHEN $4::boolean THEN $5::bytea ELSE credential_ciphertext END,
        revision=revision+1, updated_at=now() WHERE provider=$6 AND purpose=$7`,
      [enabled, priority, unitCredits, apiKey !== undefined, credential ?? null, provider, purpose]);
    await writeAuditLog(client, { adminId, action: 'ai_model.update', targetType: 'ai_model', targetId: provider,
      detail: { purpose, enabled, priority, unitCredits, expectedRevision, credentialAction: apiKey === undefined ? 'unchanged' : apiKey === null ? 'cleared' : 'updated' } });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') throw Object.assign(new Error('Primary or backup priority already assigned'), { statusCode: 409 });
    throw error;
  } finally {
    client.release();
  }
  return (await listAiModels(pool)).find(model => model.provider === provider && model.purpose === purpose);
}
