import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { decryptCredential, encryptCredential } from '../../infra/ai/config.js';
import { ModelDiscoveryError } from '../../infra/ai/discovery.js';
import { EndpointError, normalizeBaseUrl } from '../../infra/ai/endpoint.js';
import { PROTOCOLS, protocolDefinition } from '../../infra/ai/protocols.js';
import type { AiPurpose, DiscoveredModel, ModelKind, ModelParams } from '../../infra/ai/types.js';
import { writeAuditLog } from '../../infra/audit.js';
import { transaction } from '../../infra/database.js';
import { cleanApiKey, cleanName, requestError, uniqueViolation } from './_shared.js';

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

function baseUrlFor(protocol: string, value: string | null | undefined) {
  const definition = protocolDefinition(protocol);
  if (!definition) throw requestError('Unsupported protocol');
  try { return normalizeBaseUrl(value?.trim() || definition.defaultBaseUrl); } catch (error) {
    if (error instanceof EndpointError) throw requestError(error.message, 400, 'BASE_URL_INVALID');
    throw error;
  }
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

export async function listProviders(pool: Pick<pg.Pool, 'query'>) {
  const providers = (await pool.query<{ id: string; name: string; protocol: string; baseUrl: string; credentialConfigured: boolean; enabled: boolean;
    revision: number; modelCatalog: DiscoveredModel[]; catalogRefreshedAt: Date | null }>(
    `SELECT id, name, protocol, base_url AS "baseUrl", credential_ciphertext IS NOT NULL AS "credentialConfigured", enabled, revision,
       model_catalog AS "modelCatalog", catalog_refreshed_at AS "catalogRefreshedAt"
     FROM ai_providers ORDER BY created_at, id`)).rows;
  const models = (await pool.query<{ id: string; providerId: string; kind: ModelKind; model: string; params: ModelParams;
    enabled: boolean; revision: number; purposes: AiPurpose[] }>(
    `SELECT m.id, m.provider_id AS "providerId", m.kind, m.model, m.params, m.enabled, m.revision,
       COALESCE(array_agg(a.purpose ORDER BY a.purpose) FILTER (WHERE a.purpose IS NOT NULL), '{}') AS purposes
     FROM ai_models m LEFT JOIN ai_model_assignments a ON a.model_id = m.id
     GROUP BY m.id ORDER BY m.model, m.id`)).rows;
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
      // A catalog listed from another endpoint would offer models the new one may not serve.
      await client.query(`UPDATE ai_providers SET name = $2, base_url = $3, enabled = $4,
          credential_ciphertext = CASE WHEN $5::boolean THEN $6::bytea ELSE credential_ciphertext END,
          model_catalog = CASE WHEN base_url = $3 THEN model_catalog ELSE '[]' END,
          catalog_refreshed_at = CASE WHEN base_url = $3 THEN catalog_refreshed_at END, revision = revision + 1, updated_at = now()
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

/**
 * Lists provider models with the stored base URL and key and saves them as the provider's model catalog.
 * A stored key is never sent to a caller-chosen URL.
 */
export async function refreshProviderCatalog(pool: pg.Pool, id: string, adminId: string, encryptionKey: string) {
  const provider = (await pool.query<{ protocol: string; baseUrl: string; ciphertext: Buffer | null; scope: string; revision: number }>(
    `SELECT protocol, base_url AS "baseUrl", credential_ciphertext AS ciphertext, credential_scope AS scope, revision
     FROM ai_providers WHERE id = $1`, [id])).rows[0];
  if (!provider) throw requestError('Provider not found', 404);
  if (!provider.ciphertext) throw requestError('Provider has no API key', 400, 'CREDENTIAL_REQUIRED');
  const models = await discover(provider.protocol, provider.baseUrl, decryptCredential(provider.ciphertext, provider.scope, encryptionKey));
  return transaction(pool, async client => {
    // The listing took a network round trip; drop it if the provider was edited meanwhile.
    const saved = (await client.query<{ refreshedAt: Date }>(`UPDATE ai_providers SET model_catalog = $3, catalog_refreshed_at = now()
      WHERE id = $1 AND revision = $2 RETURNING catalog_refreshed_at AS "refreshedAt"`, [id, provider.revision, JSON.stringify(models)])).rows[0];
    if (!saved) throw requestError('Provider changed', 409, 'REVISION_CONFLICT');
    await writeAuditLog(client, { adminId, action: 'ai_provider.catalog_refresh', targetType: 'ai_provider', targetId: id,
      detail: { modelCount: models.length } });
    return { models, refreshedAt: saved.refreshedAt };
  });
}

/** Connection test for an unsaved provider form; nothing is stored. */
export async function probeProviderModels(input: { protocol: string; baseUrl?: string | null; apiKey: string }) {
  return discover(input.protocol, baseUrlFor(input.protocol, input.baseUrl), cleanApiKey(input.apiKey));
}
