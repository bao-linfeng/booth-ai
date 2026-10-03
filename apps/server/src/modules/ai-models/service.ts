import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { decryptCredential, encryptCredential } from '../../infra/ai/config.js';
import { ModelDiscoveryError } from '../../infra/ai/discovery.js';
import { EndpointError, normalizeBaseUrl } from '../../infra/ai/endpoint.js';
import { normalizeParams, PROTOCOLS, protocolDefinition, supportsKind, supportsPurpose } from '../../infra/ai/protocols.js';
import type { AiPurpose, DiscoveredModel, ModelKind, ModelParams } from '../../infra/ai/types.js';
import { writeAuditLog } from '../../infra/audit.js';
import { transaction } from '../../infra/database.js';

export const AI_PURPOSES: readonly AiPurpose[] = ['selection_parse', 'theme', 'artwork'];
const MAX_ASSIGNMENTS = 10;

function requestError(message: string, statusCode = 400, reason?: string) {
  return Object.assign(new Error(message), { statusCode, ...(reason ? { reason } : {}) });
}

function cleanName(value: string) {
  const name = value.trim();
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/u.test(name)) throw requestError('Invalid name');
  return name;
}

function cleanApiKey(value: string) {
  if (!value.trim() || value !== value.trim() || value.length > 2048) throw requestError('Invalid API key');
  return value;
}

function baseUrlFor(protocol: string, value: string | null | undefined) {
  const definition = protocolDefinition(protocol);
  if (!definition) throw requestError('Unsupported protocol');
  try { return normalizeBaseUrl(value?.trim() || definition.defaultBaseUrl); } catch (error) {
    if (error instanceof EndpointError) throw requestError(error.message, 400, 'BASE_URL_INVALID');
    throw error;
  }
}

function uniqueViolation(error: unknown, message: string): never {
  if ((error as { code?: string }).code === '23505') throw requestError(message, 409, 'NAME_TAKEN');
  throw error;
}

/** Protocol capabilities for the admin form: which kinds exist, their parameter schema and supported purposes. */
export function listProtocols() {
  return PROTOCOLS.map(({ id, label, description, defaultBaseUrl, listModels, suggestedModels, text, image }) => ({
    id, label, description, defaultBaseUrl, discoverable: Boolean(listModels), suggestedModels,
    kinds: [
      ...(text ? [{ kind: 'text' as const, params: text.params, purposes: ['selection_parse'] as AiPurpose[] }] : []),
      ...(image ? [{ kind: 'image' as const, params: image.params, purposes: image.purposes as AiPurpose[] }] : []),
    ],
  }));
}

export async function listProviders(pool: Pick<pg.Pool, 'query'>) {
  const providers = (await pool.query<{ id: string; name: string; protocol: string; baseUrl: string; credentialConfigured: boolean; enabled: boolean; revision: number }>(
    `SELECT id, name, protocol, base_url AS "baseUrl", credential_ciphertext IS NOT NULL AS "credentialConfigured", enabled, revision
     FROM ai_providers ORDER BY created_at, id`)).rows;
  const models = (await pool.query<{ id: string; providerId: string; name: string; kind: ModelKind; model: string; params: ModelParams;
    enabled: boolean; revision: number; purposes: AiPurpose[] }>(
    `SELECT m.id, m.provider_id AS "providerId", m.name, m.kind, m.model, m.params, m.enabled, m.revision,
       COALESCE(array_agg(a.purpose ORDER BY a.purpose) FILTER (WHERE a.purpose IS NOT NULL), '{}') AS purposes
     FROM ai_models m LEFT JOIN ai_model_assignments a ON a.model_id = m.id
     GROUP BY m.id ORDER BY m.created_at, m.id`)).rows;
  return providers.map(provider => ({ ...provider, models: models.filter(model => model.providerId === provider.id) }));
}

export interface ProviderInput { name: string; protocol: string; baseUrl?: string | null; apiKey?: string | null; enabled: boolean }

export async function createProvider(pool: pg.Pool, input: ProviderInput, adminId: string, encryptionKey: string) {
  const id = randomUUID();
  const name = cleanName(input.name);
  const baseUrl = baseUrlFor(input.protocol, input.baseUrl);
  const apiKey = input.apiKey ? cleanApiKey(input.apiKey) : null;
  if (input.enabled && !apiKey) throw requestError('API key required to enable the provider', 400, 'CREDENTIAL_REQUIRED');
  await transaction(pool, async client => {
    try {
      await client.query(`INSERT INTO ai_providers (id, name, protocol, base_url, credential_ciphertext, credential_scope, enabled)
        VALUES ($1::uuid, $2, $3, $4, $5, $1::text, $6)`, [id, name, input.protocol, baseUrl, apiKey ? encryptCredential(apiKey, id, encryptionKey) : null, input.enabled]);
    } catch (error) { uniqueViolation(error, 'Provider name already exists'); }
    await writeAuditLog(client, { adminId, action: 'ai_provider.create', targetType: 'ai_provider', targetId: id,
      detail: { name, protocol: input.protocol, baseUrl, enabled: input.enabled, credentialAction: apiKey ? 'updated' : 'unchanged' } });
  });
  return id;
}

export interface ProviderUpdate { name: string; baseUrl?: string | null; apiKey?: string | null; enabled: boolean; expectedRevision: number }

export async function updateProvider(pool: pg.Pool, id: string, input: ProviderUpdate, adminId: string, encryptionKey: string) {
  const name = cleanName(input.name);
  const apiKey = input.apiKey === undefined || input.apiKey === null ? input.apiKey : cleanApiKey(input.apiKey);
  await transaction(pool, async client => {
    const current = (await client.query<{ protocol: string; revision: number; configured: boolean; scope: string }>(
      `SELECT protocol, revision, credential_ciphertext IS NOT NULL AS configured, credential_scope AS scope FROM ai_providers WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!current) throw requestError('Provider not found', 404);
    if (current.revision !== input.expectedRevision) throw requestError('Provider changed', 409, 'REVISION_CONFLICT');
    const baseUrl = baseUrlFor(current.protocol, input.baseUrl);
    if (input.enabled && (apiKey === null || (apiKey === undefined && !current.configured))) {
      throw requestError('API key required to enable the provider', 400, 'CREDENTIAL_REQUIRED');
    }
    try {
      await client.query(`UPDATE ai_providers SET name = $2, base_url = $3, enabled = $4,
          credential_ciphertext = CASE WHEN $5::boolean THEN $6::bytea ELSE credential_ciphertext END, revision = revision + 1, updated_at = now()
        WHERE id = $1`, [id, name, baseUrl, input.enabled, apiKey !== undefined, apiKey ? encryptCredential(apiKey, current.scope, encryptionKey) : null]);
    } catch (error) { uniqueViolation(error, 'Provider name already exists'); }
    await writeAuditLog(client, { adminId, action: 'ai_provider.update', targetType: 'ai_provider', targetId: id,
      detail: { name, baseUrl, enabled: input.enabled, expectedRevision: input.expectedRevision,
        credentialAction: apiKey === undefined ? 'unchanged' : apiKey === null ? 'cleared' : 'updated' } });
  });
}

export async function deleteProvider(pool: pg.Pool, id: string, adminId: string) {
  await transaction(pool, async client => {
    const provider = (await client.query('SELECT id FROM ai_providers WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!provider) throw requestError('Provider not found', 404);
    if ((await client.query('SELECT 1 FROM ai_models WHERE provider_id = $1 LIMIT 1', [id])).rowCount) {
      throw requestError('Delete the provider models first', 409, 'PROVIDER_IN_USE');
    }
    await client.query('DELETE FROM ai_providers WHERE id = $1', [id]);
    await writeAuditLog(client, { adminId, action: 'ai_provider.delete', targetType: 'ai_provider', targetId: id });
  });
}

async function discover(protocol: string, baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const definition = protocolDefinition(protocol);
  if (!definition) throw requestError('Unsupported protocol');
  if (!definition.listModels) return definition.suggestedModels;
  try {
    const models = await definition.listModels(baseUrl, apiKey);
    return [...new Map(models.map(model => [model.id, model])).values()].sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    if (error instanceof ModelDiscoveryError) throw requestError('Model discovery failed', 400, `DISCOVERY_${error.reason}`);
    throw error;
  }
}

/** Lists provider models with the stored base URL and key; a stored key is never sent to a caller-chosen URL. */
export async function discoverProviderModels(pool: Pick<pg.Pool, 'query'>, id: string, encryptionKey: string) {
  const provider = (await pool.query<{ protocol: string; baseUrl: string; ciphertext: Buffer | null; scope: string }>(
    'SELECT protocol, base_url AS "baseUrl", credential_ciphertext AS ciphertext, credential_scope AS scope FROM ai_providers WHERE id = $1', [id])).rows[0];
  if (!provider) throw requestError('Provider not found', 404);
  if (!provider.ciphertext) throw requestError('Provider has no API key', 400, 'CREDENTIAL_REQUIRED');
  return discover(provider.protocol, provider.baseUrl, decryptCredential(provider.ciphertext, provider.scope, encryptionKey));
}

/** Connection test for an unsaved provider form; nothing is stored. */
export async function probeProviderModels(input: { protocol: string; baseUrl?: string | null; apiKey: string }) {
  return discover(input.protocol, baseUrlFor(input.protocol, input.baseUrl), cleanApiKey(input.apiKey));
}

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

export interface ModelInput { providerId: string; name: string; kind: ModelKind; model: string; params: Record<string, unknown>; enabled: boolean }

export async function createModel(pool: pg.Pool, input: ModelInput, adminId: string) {
  const id = randomUUID();
  const name = cleanName(input.name);
  const model = cleanModelId(input.model);
  await transaction(pool, async client => {
    const provider = (await client.query<{ protocol: string }>('SELECT protocol FROM ai_providers WHERE id = $1 FOR SHARE', [input.providerId])).rows[0];
    if (!provider) throw requestError('Provider not found', 404);
    if (!supportsKind(provider.protocol, input.kind)) throw requestError('Protocol does not support this model kind', 400, 'KIND_UNSUPPORTED');
    const normalized = params(provider.protocol, input.kind, input.params);
    try {
      await client.query(`INSERT INTO ai_models (id, provider_id, name, kind, model, params, enabled) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, input.providerId, name, input.kind, model, JSON.stringify(normalized), input.enabled]);
    } catch (error) { uniqueViolation(error, 'Model name already exists'); }
    await writeAuditLog(client, { adminId, action: 'ai_model.create', targetType: 'ai_model', targetId: id,
      detail: { providerId: input.providerId, name, kind: input.kind, model, params: normalized, enabled: input.enabled } });
  });
  return id;
}

export interface ModelUpdate { name: string; model: string; params: Record<string, unknown>; enabled: boolean; expectedRevision: number }

export async function updateModel(pool: pg.Pool, id: string, input: ModelUpdate, adminId: string) {
  const name = cleanName(input.name);
  const model = cleanModelId(input.model);
  await transaction(pool, async client => {
    const current = (await client.query<{ revision: number; kind: ModelKind; protocol: string }>(
      `SELECT m.revision, m.kind, p.protocol FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id WHERE m.id = $1 FOR UPDATE OF m`, [id])).rows[0];
    if (!current) throw requestError('Model not found', 404);
    if (current.revision !== input.expectedRevision) throw requestError('Model changed', 409, 'REVISION_CONFLICT');
    const normalized = params(current.protocol, current.kind, input.params);
    try {
      await client.query(`UPDATE ai_models SET name = $2, model = $3, params = $4, enabled = $5, revision = revision + 1, updated_at = now() WHERE id = $1`,
        [id, name, model, JSON.stringify(normalized), input.enabled]);
    } catch (error) { uniqueViolation(error, 'Model name already exists'); }
    await writeAuditLog(client, { adminId, action: 'ai_model.update', targetType: 'ai_model', targetId: id,
      detail: { name, model, params: normalized, enabled: input.enabled, expectedRevision: input.expectedRevision } });
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

export interface AssignmentItem { modelId: string; unitCredits: number | null }

function assignmentVersion(items: AssignmentItem[]) {
  return createHash('sha256').update(JSON.stringify(items.map(({ modelId, unitCredits }) => [modelId, unitCredits]))).digest('hex').slice(0, 16);
}

async function purposeItems(database: Pick<pg.Pool, 'query'>, purpose: AiPurpose) {
  return (await database.query<AssignmentItem>(`SELECT model_id AS "modelId", unit_credits AS "unitCredits"
    FROM ai_model_assignments WHERE purpose = $1 ORDER BY position`, [purpose])).rows;
}

export async function listAssignments(pool: Pick<pg.Pool, 'query'>) {
  return Promise.all(AI_PURPOSES.map(async purpose => {
    const items = await purposeItems(pool, purpose);
    return { purpose, version: assignmentVersion(items), items };
  }));
}

/** Replaces the ordered model list of one purpose; position 1 is the primary model. */
export async function replaceAssignments(pool: pg.Pool, purpose: AiPurpose, input: { expectedVersion: string; items: AssignmentItem[] }, adminId: string) {
  const { items } = input;
  if (items.length > MAX_ASSIGNMENTS || new Set(items.map(item => item.modelId)).size !== items.length) throw requestError('Invalid assignment list');
  if (items.some(item => purpose === 'selection_parse' ? item.unitCredits !== null :
    !Number.isInteger(item.unitCredits) || item.unitCredits! < 1 || item.unitCredits! > 100000)) {
    throw requestError('Image purposes need credits per unit; text purposes take none', 400, 'CREDITS_INVALID');
  }
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ai_model_assignments:${purpose}`]);
    if (assignmentVersion(await purposeItems(client, purpose)) !== input.expectedVersion) throw requestError('Assignments changed', 409, 'REVISION_CONFLICT');
    const models = (await client.query<{ id: string; kind: ModelKind; protocol: string }>(
      'SELECT m.id, m.kind, p.protocol FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id WHERE m.id = ANY($1::uuid[]) FOR SHARE OF m',
      [items.map(item => item.modelId)])).rows;
    for (const item of items) {
      const model = models.find(candidate => candidate.id === item.modelId);
      if (!model) throw requestError('Model not found', 404);
      if (!supportsPurpose(model.protocol, model.kind, purpose)) throw requestError('Model cannot serve this purpose', 400, 'PURPOSE_UNSUPPORTED');
    }
    await client.query('DELETE FROM ai_model_assignments WHERE purpose = $1', [purpose]);
    for (const [index, item] of items.entries()) {
      await client.query('INSERT INTO ai_model_assignments (purpose, model_id, position, unit_credits) VALUES ($1, $2, $3, $4)',
        [purpose, item.modelId, index + 1, item.unitCredits]);
    }
    await writeAuditLog(client, { adminId, action: 'ai_model_assignment.replace', targetType: 'ai_model_assignment', targetId: purpose,
      detail: { items, expectedVersion: input.expectedVersion } });
  });
  return { purpose, version: assignmentVersion(items), items };
}
