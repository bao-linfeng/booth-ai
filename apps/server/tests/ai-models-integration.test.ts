import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { activeAiModels, decryptCredential, encryptCredential } from '../src/infra/ai/config.js';
import {
  createModel, createProvider, deleteModel, deleteProvider, listAssignments, listProviders, replaceAssignments, updateModel, updateProvider,
} from '../src/modules/ai-models/service.js';

const encryptionKey = 'a'.repeat(64);

test('AI model configuration: legacy migration, provider/model CRUD and purpose assignments against PostgreSQL',
  { skip: !process.env.AI_MODEL_TEST_DATABASE_URL }, async t => {
    const schema = `ai_models_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.AI_MODEL_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.AI_MODEL_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end(); });
    const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    const apply = async (names: string[]) => { for (const name of names) await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')); };
    await apply(migrations.filter(name => name < '056'));

    // Legacy rows as the previous admin page stored them: keys encrypted with the provider name as associated data.
    const legacy = (purpose: string, provider: string, enabled: boolean, priority: number, credits: number | null, key: string | null) => pool.query(
      `UPDATE ai_model_configs SET enabled=$3, priority=$4, unit_credits=$5, credential_ciphertext=$6 WHERE purpose=$1 AND provider=$2`,
      [purpose, provider, enabled, priority, credits, key ? encryptCredential(key, provider, encryptionKey) : null]);
    await legacy('selection_parse', 'deepseek', true, 1, null, 'deepseek-key');
    await legacy('theme', 'gemini', true, 0, 7, 'gemini-key');
    await legacy('theme', 'openai', false, 0, 10, 'openai-key');
    await legacy('artwork', 'openai', true, 0, 5, 'openai-key');
    await apply(migrations.filter(name => name >= '056'));

    assert.equal((await pool.query("SELECT to_regclass('ai_model_configs') AS t")).rows[0].t, null);
    const providers = await listProviders(pool);
    assert.deepEqual(providers.map(provider => [provider.name, provider.protocol, provider.baseUrl]).sort(), [
      ['DeepSeek', 'openai', 'https://api.deepseek.com'], ['Google Gemini', 'gemini', 'https://generativelanguage.googleapis.com/v1beta'],
      ['OpenAI', 'openai', 'https://api.openai.com/v1']]);
    const openai = providers.find(provider => provider.name === 'OpenAI')!;
    assert.deepEqual(openai.models.map(model => [model.model, model.purposes]).sort(), [['gpt-image-1.5', ['artwork']], ['gpt-image-2.5-sunburst', []]]);
    const stored = (await pool.query('SELECT credential_ciphertext AS c, credential_scope AS s FROM ai_providers WHERE id=$1', [openai.id])).rows[0];
    assert.equal(decryptCredential(stored.c, stored.s, encryptionKey), 'openai-key');
    const [theme] = await activeAiModels(pool, 'theme', encryptionKey);
    assert.deepEqual([theme?.model, theme?.unitCredits, theme?.apiKey, theme?.position], ['gemini-3.1-flash-image', 7, 'gemini-key', 1]);
    assert.deepEqual((await activeAiModels(pool, 'selection_parse', encryptionKey)).map(model => model.model), ['deepseek-v4-flash']);
    assert.deepEqual((await activeAiModels(pool, 'artwork', encryptionKey)).map(model => [model.model, model.unitCredits]), [['gpt-image-1.5', 5]]);

    const admin = randomUUID();
    await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,1,'test',ARRAY['ROLE_ADMIN'])", [admin]);
    const relay = await createProvider(pool, { name: 'Relay', protocol: 'openai', baseUrl: 'https://203.0.113.20/v1', apiKey: 'relay-key', enabled: true }, admin, encryptionKey);
    await assert.rejects(createProvider(pool, { name: 'relay ', protocol: 'openai', apiKey: 'k', enabled: true }, admin, encryptionKey), { statusCode: 409 });
    const chat = await createModel(pool, { providerId: relay, name: 'Relay Chat', kind: 'text', model: 'gpt-test', params: { temperature: 0.2 }, enabled: true }, admin);
    await assert.rejects(createModel(pool, { providerId: relay, name: 'Bad', kind: 'text', model: 'x', params: { temperature: 9 }, enabled: true }, admin),
      { statusCode: 400, reason: 'PARAMS_INVALID' });
    await assert.rejects(createModel(pool, { providerId: providers.find(p => p.protocol === 'gemini')!.id, name: 'Gemini Text', kind: 'text', model: 'g',
      params: {}, enabled: true }, admin), { statusCode: 400, reason: 'KIND_UNSUPPORTED' });
    const parse = (await listAssignments(pool)).find(item => item.purpose === 'selection_parse')!;
    await replaceAssignments(pool, 'selection_parse', { expectedVersion: parse.version, items: [...parse.items, { modelId: chat, unitCredits: null }] }, admin);
    const parsers = await activeAiModels(pool, 'selection_parse', encryptionKey);
    assert.deepEqual(parsers.map(model => [model.name, model.position, model.baseUrl, model.apiKey, model.params.temperature]),
      [['DeepSeek V4 Flash', 1, 'https://api.deepseek.com', 'deepseek-key', 0], ['Relay Chat', 2, 'https://203.0.113.20/v1', 'relay-key', 0.2]]);

    // A single image model can serve theme and artwork at different prices.
    const gemini = providers.find(provider => provider.protocol === 'gemini')!.models[0]!;
    const artwork = (await listAssignments(pool)).find(item => item.purpose === 'artwork')!;
    await replaceAssignments(pool, 'artwork', { expectedVersion: artwork.version, items: [{ modelId: gemini.id, unitCredits: 12 }, ...artwork.items] }, admin);
    assert.deepEqual((await activeAiModels(pool, 'artwork', encryptionKey)).map(model => [model.model, model.unitCredits]),
      [['gemini-3.1-flash-image', 12], ['gpt-image-1.5', 5]]);
    assert.deepEqual((await listProviders(pool)).flatMap(provider => provider.models).find(model => model.id === gemini.id)?.purposes, ['artwork', 'theme']);

    await updateModel(pool, chat, { name: 'Relay Chat', model: 'gpt-test-2', params: {}, enabled: false, expectedRevision: 1 }, admin);
    assert.deepEqual((await activeAiModels(pool, 'selection_parse', encryptionKey)).map(model => model.name), ['DeepSeek V4 Flash']);
    await assert.rejects(updateModel(pool, chat, { name: 'Relay Chat', model: 'x', params: {}, enabled: true, expectedRevision: 1 }, admin), { statusCode: 409 });
    await assert.rejects(deleteModel(pool, chat, admin), { statusCode: 409, reason: 'MODEL_IN_USE' });
    await assert.rejects(deleteProvider(pool, relay, admin), { statusCode: 409, reason: 'PROVIDER_IN_USE' });
    await updateProvider(pool, relay, { name: 'Relay', baseUrl: 'https://203.0.113.20/v2', enabled: false, apiKey: null, expectedRevision: 1 }, admin, encryptionKey);
    const relayRow = (await listProviders(pool)).find(provider => provider.id === relay)!;
    assert.deepEqual([relayRow.baseUrl, relayRow.enabled, relayRow.credentialConfigured, relayRow.revision], ['https://203.0.113.20/v2', false, false, 2]);
    const cleared = (await listAssignments(pool)).find(item => item.purpose === 'selection_parse')!;
    await replaceAssignments(pool, 'selection_parse', { expectedVersion: cleared.version, items: cleared.items.filter(item => item.modelId !== chat) }, admin);
    await deleteModel(pool, chat, admin);
    await deleteProvider(pool, relay, admin);
    const audit = (await pool.query<{ action: string; detail: unknown }>('SELECT action, detail FROM admin_audit_logs ORDER BY created_at')).rows;
    assert.ok(audit.some(entry => entry.action === 'ai_model_assignment.replace'));
    assert.equal(JSON.stringify(audit).includes('relay-key'), false);
  });
