import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import { activeAiModels, decryptCredential, encryptCredential, listAiModels } from '../src/infra/ai-models.js';
import { updateAiModel } from '../src/modules/generation/models.js';

const encryptionKey = 'a'.repeat(64);
const providerKey = 'private-test-key';
const initial = () => ({ purpose: 'theme', provider: 'gemini', enabled: false, priority: 0, unitCredits: null as number | null, revision: 1,
  credentialCiphertext: null as Buffer | null });

test('model credentials are authenticated and never exposed by config listing', async () => {
  const ciphertext = encryptCredential(providerKey, 'gemini', encryptionKey);
  assert.notEqual(ciphertext.toString('utf8'), providerKey);
  assert.equal(decryptCredential(ciphertext, 'gemini', encryptionKey), providerKey);
  assert.throws(() => decryptCredential(ciphertext, 'wanx', encryptionKey));
  assert.throws(() => decryptCredential(ciphertext, 'gemini', 'b'.repeat(64)));
  const pool = { query: async () => ({ rows: [
    { ...initial(), enabled: true, unitCredits: 10, credentialCiphertext: ciphertext },
    { ...initial(), provider: 'wanx', enabled: true, unitCredits: 5 },
    { ...initial(), provider: 'openai', enabled: true, unitCredits: 20,
      credentialCiphertext: encryptCredential(providerKey, 'openai', encryptionKey) },
  ] }) } as unknown as pg.Pool;
  const models = await listAiModels(pool);
  assert.equal(JSON.stringify(models).includes(providerKey), false);
  assert.equal(JSON.stringify(models).includes('credentialCiphertext'), false);
  assert.equal(models[0]?.credentialConfigured, true);
  assert.equal(models[1]?.credentialConfigured, false);
  assert.equal(models[2]?.model, 'gpt-image-2.5-sunburst');
  assert.equal(models[2]?.credentialConfigured, true);
  const active = await activeAiModels(pool, 'theme', encryptionKey);
  assert.deepEqual(active.map(model => model.provider), ['gemini', 'openai']);
  assert.equal(active[0]?.apiKey, providerKey);
  assert.equal(active[1]?.apiKey, providerKey);
});

test('saving, keeping, and clearing a key are atomic and audited without secret content', async () => {
  const row = initial();
  const audit: string[] = [];
  const client = { query: async (sql: string, values?: unknown[]) => {
    if (sql.startsWith('SELECT credential_ciphertext')) return { rows: [{ configured: row.credentialCiphertext !== null, revision: row.revision }] };
    if (sql.startsWith('UPDATE ai_model_configs')) {
      row.enabled = values?.[0] as boolean;
      row.unitCredits = values?.[2] as number | null;
      if (values?.[3]) row.credentialCiphertext = values[4] as Buffer | null;
      row.revision++;
    }
    if (sql.startsWith('INSERT INTO admin_audit_logs')) audit.push(values?.[4] as string);
    return { rows: [] };
  }, release: () => {} };
  const pool = { connect: async () => client, query: async () => ({ rows: [row] }) } as unknown as pg.Pool;
  const saved = await updateAiModel(pool, 'gemini', { purpose: 'theme', enabled: true, priority: 0, unitCredits: 10,
    expectedRevision: 1, apiKey: providerKey }, 'admin-1', encryptionKey);
  assert.equal(saved?.credentialConfigured, true);
  assert.equal(decryptCredential(row.credentialCiphertext!, 'gemini', encryptionKey), providerKey);
  const ciphertext = row.credentialCiphertext;
  await updateAiModel(pool, 'gemini', { purpose: 'theme', enabled: true, priority: 0, unitCredits: 12, expectedRevision: 2 }, 'admin-1', encryptionKey);
  assert.equal(row.credentialCiphertext, ciphertext);
  await updateAiModel(pool, 'gemini', { purpose: 'theme', enabled: false, priority: 0, unitCredits: 12,
    expectedRevision: 3, apiKey: null }, 'admin-1', encryptionKey);
  assert.equal(row.credentialCiphertext, null);
  assert.equal(row.enabled, false);
  assert.equal(audit.length, 3);
  assert.equal(JSON.stringify(audit).includes(providerKey), false);
  await assert.rejects(() => updateAiModel(pool, 'gemini', { purpose: 'theme', enabled: false, priority: 0,
    unitCredits: 12, expectedRevision: 3, apiKey: 'another-key' }, 'admin-1', encryptionKey), { statusCode: 409 });
  await assert.rejects(() => updateAiModel(pool, 'gemini', { purpose: 'theme', enabled: true, priority: 0,
    unitCredits: 12, expectedRevision: 4 }, 'admin-1', encryptionKey), { statusCode: 400 });
});

test('artwork model updates target the purpose/provider pair and reject parser purpose misuse', async () => {
  const queries: { sql: string; values?: unknown[] }[] = [];
  const client = { query: async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    return sql.startsWith('SELECT credential_ciphertext') ? { rows: [{ configured: true, revision: 2 }] } : { rows: [] };
  }, release: () => {} };
  const pool = { connect: async () => client, query: async () => ({ rows: [{ ...initial(), purpose: 'artwork', provider: 'openai' }] }) } as unknown as pg.Pool;
  const saved = await updateAiModel(pool, 'openai', { purpose: 'artwork', enabled: true, priority: 0, unitCredits: 10, expectedRevision: 2 }, 'admin', encryptionKey);
  assert.equal(saved?.model, 'gpt-image-1.5');
  const selected = queries.find(q => q.sql.startsWith('SELECT credential_ciphertext'))!;
  assert.match(selected.sql, /provider=\$1 AND purpose=\$2/); assert.deepEqual(selected.values, ['openai', 'artwork']);
  const updated = queries.find(q => q.sql.startsWith('UPDATE ai_model_configs'))!;
  assert.match(updated.sql, /provider=\$6 AND purpose=\$7/); assert.equal(updated.values?.[6], 'artwork');
  await assert.rejects(updateAiModel(pool, 'qwen', { purpose: 'artwork', enabled: true, priority: 0, unitCredits: 10, expectedRevision: 2 }, 'admin', encryptionKey), { statusCode: 400 });
});
