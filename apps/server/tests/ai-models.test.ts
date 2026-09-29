import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import { activeAiModels, decryptCredential, encryptCredential, listAiModels } from '../src/infra/ai-models.js';
import { updateAiModel } from '../src/modules/admin/ai-models/service.js';

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
  ] }) } as unknown as pg.Pool;
  const models = await listAiModels(pool);
  assert.equal(JSON.stringify(models).includes(providerKey), false);
  assert.equal(JSON.stringify(models).includes('credentialCiphertext'), false);
  assert.equal(models[0]?.credentialConfigured, true);
  assert.equal(models[1]?.credentialConfigured, false);
  const active = await activeAiModels(pool, 'theme', encryptionKey);
  assert.deepEqual(active.map(model => model.provider), ['gemini']);
  assert.equal(active[0]?.apiKey, providerKey);
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
  const saved = await updateAiModel(pool, 'gemini', { enabled: true, priority: 0, unitCredits: 10,
    expectedRevision: 1, apiKey: providerKey }, 'admin-1', encryptionKey);
  assert.equal(saved?.credentialConfigured, true);
  assert.equal(decryptCredential(row.credentialCiphertext!, 'gemini', encryptionKey), providerKey);
  const ciphertext = row.credentialCiphertext;
  await updateAiModel(pool, 'gemini', { enabled: true, priority: 0, unitCredits: 12, expectedRevision: 2 }, 'admin-1', encryptionKey);
  assert.equal(row.credentialCiphertext, ciphertext);
  await updateAiModel(pool, 'gemini', { enabled: false, priority: 0, unitCredits: 12,
    expectedRevision: 3, apiKey: null }, 'admin-1', encryptionKey);
  assert.equal(row.credentialCiphertext, null);
  assert.equal(row.enabled, false);
  assert.equal(audit.length, 3);
  assert.equal(JSON.stringify(audit).includes(providerKey), false);
  await assert.rejects(() => updateAiModel(pool, 'gemini', { enabled: false, priority: 0,
    unitCredits: 12, expectedRevision: 3, apiKey: 'another-key' }, 'admin-1', encryptionKey), { statusCode: 409 });
  await assert.rejects(() => updateAiModel(pool, 'gemini', { enabled: true, priority: 0,
    unitCredits: 12, expectedRevision: 4 }, 'admin-1', encryptionKey), { statusCode: 400 });
});
