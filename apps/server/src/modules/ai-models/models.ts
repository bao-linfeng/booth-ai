import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { normalizeParams, supportsKind } from '../../infra/ai/protocols.js';
import type { ModelKind, ModelParams } from '../../infra/ai/types.js';
import { writeAuditLog } from '../../infra/audit.js';
import { transaction } from '../../infra/database.js';
import { requestError, uniqueViolation } from './_shared.js';

function cleanModelId(value: string) {
  const model = value.trim();
  if (!model || model.length > 200 || /[\s\u0000-\u001f\u007f]/u.test(model)) throw requestError('Invalid model id');
  return model;
}

function params(protocol: string, kind: ModelKind, input: Record<string, unknown>) {
  try { return normalizeParams(protocol, kind, input); } catch (error) {
    throw requestError(error instanceof Error ? error.message : 'Invalid model parameter', 400, 'PARAMS_INVALID');
  }
}

export interface ModelInput { providerId: string; kind: ModelKind; model: string; params: Record<string, unknown>; enabled: boolean }

export async function createModel(pool: pg.Pool, input: ModelInput, adminId: string) {
  const id = randomUUID();
  const model = cleanModelId(input.model);
  await transaction(pool, async client => {
    const provider = (await client.query<{ protocol: string }>('SELECT protocol FROM ai_providers WHERE id = $1 FOR SHARE', [input.providerId])).rows[0];
    if (!provider) throw requestError('Provider not found', 404);
    if (!supportsKind(provider.protocol, input.kind)) throw requestError('Protocol does not support this model kind', 400, 'KIND_UNSUPPORTED');
    const normalized = params(provider.protocol, input.kind, input.params);
    try {
      await client.query(`INSERT INTO ai_models (id, provider_id, kind, model, params, enabled) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, input.providerId, input.kind, model, JSON.stringify(normalized), input.enabled]);
    } catch (error) { uniqueViolation(error, 'Model already added to this provider', 'MODEL_TAKEN'); }
    await writeAuditLog(client, { adminId, action: 'ai_model.create', targetType: 'ai_model', targetId: id,
      detail: { providerId: input.providerId, kind: input.kind, model, params: normalized, enabled: input.enabled } });
  });
  return id;
}

export interface ModelUpdate { model: string; params: Record<string, unknown>; enabled: boolean; expectedRevision: number }

export async function updateModel(pool: pg.Pool, id: string, input: ModelUpdate, adminId: string) {
  const model = cleanModelId(input.model);
  await transaction(pool, async client => {
    const current = (await client.query<{ revision: number; kind: ModelKind; protocol: string }>(
      `SELECT m.revision, m.kind, p.protocol FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id WHERE m.id = $1 FOR UPDATE OF m`, [id])).rows[0];
    if (!current) throw requestError('Model not found', 404);
    if (current.revision !== input.expectedRevision) throw requestError('Model changed', 409, 'REVISION_CONFLICT');
    const normalized = params(current.protocol, current.kind, input.params);
    try {
      await client.query(`UPDATE ai_models SET model = $2, params = $3, enabled = $4, revision = revision + 1, updated_at = now() WHERE id = $1`,
        [id, model, JSON.stringify(normalized), input.enabled]);
    } catch (error) { uniqueViolation(error, 'Model already added to this provider', 'MODEL_TAKEN'); }
    await writeAuditLog(client, { adminId, action: 'ai_model.update', targetType: 'ai_model', targetId: id,
      detail: { model, params: normalized, enabled: input.enabled, expectedRevision: input.expectedRevision } });
  });
}

export async function deleteModel(pool: pg.Pool, id: string, adminId: string) {
  await transaction(pool, async client => {
    const model = (await client.query('SELECT id FROM ai_models WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!model) throw requestError('Model not found', 404);
    if ((await client.query('SELECT 1 FROM ai_model_assignments WHERE model_id = $1 LIMIT 1', [id])).rowCount) {
      throw requestError('Remove the model from its purposes first', 409, 'MODEL_IN_USE');
    }
    await client.query('DELETE FROM ai_models WHERE id = $1', [id]);
    await writeAuditLog(client, { adminId, action: 'ai_model.delete', targetType: 'ai_model', targetId: id });
  });
}

// Re-export types used in listProviders (defined in providers.ts but shared here for convenience)
export type { ModelKind, ModelParams };
