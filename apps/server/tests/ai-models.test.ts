import assert from 'node:assert/strict';
import dns from 'node:dns';
import { test } from 'node:test';
import type pg from 'pg';
import { activeAiModels, assignedAiModels, decryptCredential, encryptCredential } from '../src/infra/ai/config.js';
import type { ProviderProtocol } from '../src/infra/ai/types.js';
import {
  createProvider, listAssignments, listProtocols, probeProviderModels, refreshProviderCatalog, replaceAssignments, updateProvider,
} from '../src/modules/ai-models/service.js';
import { assignedRow, testEncryptionKey as encryptionKey } from './ai-fixtures.js';

const providerKey = 'private-test-key';
type Query = { sql: string; values?: unknown[] };

function recordingPool(answer: (sql: string, values?: unknown[]) => { rows: unknown[]; rowCount?: number } = () => ({ rows: [] })) {
  const queries: Query[] = [];
  const query = async (sql: string, values?: unknown[]) => { queries.push({ sql, values }); return { rowCount: 1, ...answer(sql, values) }; };
  const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as pg.Pool;
  return { pool, queries };
}

test('credentials are bound to their provider scope', () => {
  const ciphertext = encryptCredential(providerKey, 'provider-a', encryptionKey);
  assert.equal(ciphertext.toString('utf8').includes(providerKey), false);
  assert.equal(decryptCredential(ciphertext, 'provider-a', encryptionKey), providerKey);
  assert.throws(() => decryptCredential(ciphertext, 'provider-b', encryptionKey));
  assert.throws(() => decryptCredential(ciphertext, 'provider-a', 'b'.repeat(64)));
});

test('only assignments whose protocol can serve the purpose are usable, and listings never carry secrets', async () => {
  const rows = [assignedRow('openai', 'theme', { model: 'gpt-image-test' }), assignedRow('openai', 'theme', { protocol: 'retired' as ProviderProtocol }),
    assignedRow('gemini', 'theme', { unitCredits: null }), assignedRow('openai', 'selection_parse', { kind: 'image' }),
    assignedRow('openai', 'cs_translation', { model: 'gpt-text-test' }), assignedRow('openai', 'cs_translation', { kind: 'image' })];
  const pool = { query: async (_sql: string, [purpose]: [string]) => ({ rows: rows.filter(row => row.purpose === purpose) }) } as unknown as pg.Pool;
  const active = await activeAiModels(pool, 'theme', encryptionKey);
  assert.deepEqual(active.map(model => model.model), ['gpt-image-test']);
  assert.equal(active[0]?.apiKey, 'secret');
  const assigned = await assignedAiModels(pool, 'theme');
  assert.deepEqual(Object.keys(assigned[0]!).filter(key => /key|credential|baseUrl/i.test(key)), []);
  assert.deepEqual((await assignedAiModels(pool, 'cs_translation')).map(model => [model.model, model.unitCredits]), [['gpt-text-test', null]]);
});

test('protocol listing exposes kinds, purposes and parameter forms for the admin UI', () => {
  const protocols = listProtocols();
  const openai = protocols.find(protocol => protocol.id === 'openai')!;
  assert.deepEqual(openai.kinds.map(kind => kind.kind), ['text', 'image']);
  assert.deepEqual(openai.kinds[0]?.purposes, ['selection_parse', 'cs_translation']);
  assert.deepEqual(openai.kinds[1]?.purposes, ['theme', 'artwork']);
  assert.ok(openai.kinds[0]?.params.some(field => field.key === 'temperature'));
  const qwenImage = protocols.find(protocol => protocol.id === 'qwen-image')!;
  assert.equal(qwenImage.discoverable, false);
  assert.deepEqual(qwenImage.kinds.map(kind => kind.kind), ['image']);
  assert.equal(protocols.some(protocol => String(protocol.id) === 'dashscope'), false);
});

test('providers validate base URLs and keys, store keys encrypted to their own id and audit without secrets', async () => {
  for (const baseUrl of ['http://api.example.com/v1', 'https://localhost/v1', 'https://192.168.1.10/v1', 'https://user:pass@api.example.com']) {
    await assert.rejects(createProvider(recordingPool().pool, { name: 'x', protocol: 'openai', baseUrl, apiKey: providerKey, enabled: true },
      'admin', encryptionKey), { statusCode: 400, reason: 'BASE_URL_INVALID' });
  }
  await assert.rejects(createProvider(recordingPool().pool, { name: 'x', protocol: 'openai', enabled: true }, 'admin', encryptionKey),
    { statusCode: 400, reason: 'CREDENTIAL_REQUIRED' });
  await assert.rejects(createProvider(recordingPool().pool, { name: 'x', protocol: 'unknown', apiKey: providerKey, enabled: true }, 'admin', encryptionKey),
    { statusCode: 400 });
  const { pool, queries } = recordingPool();
  const id = await createProvider(pool, { name: ' 中转 ', protocol: 'openai', baseUrl: 'https://relay.example.com/v1/', apiKey: providerKey, enabled: true },
    'admin', encryptionKey);
  const insert = queries.find(query => query.sql.includes('INSERT INTO ai_providers'))!;
  assert.deepEqual(insert.values?.slice(0, 4), [id, '中转', 'openai', 'https://relay.example.com/v1']);
  assert.equal(decryptCredential(insert.values?.[4] as Buffer, id, encryptionKey), providerKey);
  const defaulted = recordingPool();
  await createProvider(defaulted.pool, { name: 'Gemini', protocol: 'gemini', apiKey: providerKey, enabled: true }, 'admin', encryptionKey);
  assert.equal(defaulted.queries.find(query => query.sql.includes('INSERT INTO ai_providers'))?.values?.[3], 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(JSON.stringify(queries.filter(query => query.sql.includes('admin_audit_logs'))).includes(providerKey), false);
});

test('provider updates keep, rotate or clear the key under the original scope with optimistic revisions', async () => {
  const current = { protocol: 'openai', revision: 4, configured: true, scope: 'legacy-openai' };
  const { pool, queries } = recordingPool(sql => sql.startsWith('SELECT protocol, revision') ? { rows: [current] } : { rows: [] });
  const update = { name: 'OpenAI', baseUrl: null, enabled: true, expectedRevision: 4 };
  await updateProvider(pool, 'p1', { ...update, apiKey: 'rotated-key' }, 'admin', encryptionKey);
  const rotated = queries.find(query => query.sql.startsWith('UPDATE ai_providers'))!;
  assert.equal(rotated.values?.[2], 'https://api.openai.com/v1');
  assert.equal(decryptCredential(rotated.values?.[5] as Buffer, 'legacy-openai', encryptionKey), 'rotated-key');
  await assert.rejects(updateProvider(pool, 'p1', { ...update, apiKey: null }, 'admin', encryptionKey), { statusCode: 400, reason: 'CREDENTIAL_REQUIRED' });
  await assert.rejects(updateProvider(pool, 'p1', { ...update, expectedRevision: 3 }, 'admin', encryptionKey), { statusCode: 409 });
  await updateProvider(pool, 'p1', { ...update, enabled: false, apiKey: null }, 'admin', encryptionKey);
  assert.equal(queries.filter(query => query.sql.startsWith('UPDATE ai_providers')).at(-1)?.values?.[4], true);
  assert.equal(JSON.stringify(queries).includes('rotated-key'), false);
});

test('assignments enforce purpose capability, credit rules and optimistic versions', async () => {
  const models = [{ id: '00000000-0000-0000-0000-000000000001', kind: 'image', protocol: 'gemini' },
    { id: '00000000-0000-0000-0000-000000000002', kind: 'image', protocol: 'qwen-image' },
    { id: '00000000-0000-0000-0000-000000000003', kind: 'text', protocol: 'openai' }];
  const { pool, queries } = recordingPool(sql => sql.includes('FROM ai_models m JOIN ai_providers') ? { rows: models } : { rows: [] });
  const [, theme, artwork] = await listAssignments(pool);
  const [gemini, qwenImage, chat] = models.map(model => model.id);
  const saved = await replaceAssignments(pool, 'theme', { expectedVersion: theme!.version, items: [
    { modelId: gemini!, unitCredits: 7 }, { modelId: qwenImage!, unitCredits: 3 }] }, 'admin');
  const inserts = queries.filter(query => query.sql.startsWith('INSERT INTO ai_model_assignments'));
  assert.deepEqual(inserts.map(query => query.values), [['theme', gemini, 1, 7], ['theme', qwenImage, 2, 3]]);
  assert.notEqual(saved.version, theme!.version);
  // One model may serve theme and artwork with independent prices.
  await replaceAssignments(pool, 'artwork', { expectedVersion: artwork!.version, items: [{ modelId: gemini!, unitCredits: 12 }] }, 'admin');
  for (const [purpose, items, reason] of [
    ['artwork', [{ modelId: chat!, unitCredits: 3 }], 'PURPOSE_UNSUPPORTED'],
    ['theme', [{ modelId: chat!, unitCredits: 3 }], 'PURPOSE_UNSUPPORTED'],
    ['selection_parse', [{ modelId: chat!, unitCredits: 3 }], 'CREDITS_INVALID'],
    ['cs_translation', [{ modelId: chat!, unitCredits: 3 }], 'CREDITS_INVALID'],
    ['cs_translation', [{ modelId: gemini!, unitCredits: null }], 'PURPOSE_UNSUPPORTED'],
    ['theme', [{ modelId: gemini!, unitCredits: null }], 'CREDITS_INVALID'],
  ] as const) {
    await assert.rejects(replaceAssignments(pool, purpose, { expectedVersion: artwork!.version, items: [...items] }, 'admin'), { statusCode: 400, reason });
  }
  await assert.rejects(replaceAssignments(pool, 'theme', { expectedVersion: 'stale', items: [] }, 'admin'), { statusCode: 409 });
  await assert.rejects(replaceAssignments(pool, 'theme', { expectedVersion: theme!.version, items: [
    { modelId: gemini!, unitCredits: 1 }, { modelId: gemini!, unitCredits: 2 }] }, 'admin'), { statusCode: 400 });
});

test('model discovery lists provider models, classifies kinds and maps failures to safe reasons', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const requests: { url: string; headers: Headers }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    assert.equal(init?.redirect, 'error');
    return String(input).includes('generativelanguage') ? Response.json({ models: [
      { name: 'models/gemini-3.1-flash-image', displayName: 'Nano Banana 2', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] }) : Response.json({ data: [{ id: 'gpt-image-1.5' }, { id: 'deepseek-chat' }, { id: 'text-embedding-3-small' }] });
  };
  assert.deepEqual(await probeProviderModels({ protocol: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: providerKey }), [
    { id: 'deepseek-chat', kind: 'text' }, { id: 'gpt-image-1.5', kind: 'image' }, { id: 'text-embedding-3-small' }]);
  assert.equal(requests[0]?.url, 'https://api.deepseek.com/models');
  assert.equal(requests[0]?.headers.get('authorization'), `Bearer ${providerKey}`);
  assert.deepEqual(await probeProviderModels({ protocol: 'gemini', apiKey: providerKey }), [
    { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', kind: 'image' }]);
  assert.equal(requests[1]?.headers.get('x-goog-api-key'), providerKey);
  assert.deepEqual((await probeProviderModels({ protocol: 'qwen-image', apiKey: providerKey })).map(model => model.id),
    ['qwen-image-3.0-pro', 'qwen-image-3.0', 'wan2.7-image-pro', 'wan2.7-image']);
  assert.deepEqual((await probeProviderModels({ protocol: 'ark', apiKey: providerKey })).map(model => model.id).slice(0, 2),
    ['doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-flash-260915']);
  assert.equal(requests.length, 2, 'qwen-image and ark suggestions need no request');
  const stored = { protocol: 'openai', baseUrl: 'https://relay.example.com/v1', ciphertext: encryptCredential(providerKey, 'p1', encryptionKey), scope: 'p1', revision: 2 };
  const refreshedAt = new Date();
  let saveMatches = true;
  const { pool, queries } = recordingPool(sql => sql.startsWith('SELECT protocol') ? { rows: [stored] }
    : sql.startsWith('UPDATE ai_providers') ? { rows: saveMatches ? [{ refreshedAt }] : [] } : { rows: [] });
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  const refreshed = await refreshProviderCatalog(pool, 'p1', 'admin', encryptionKey);
  assert.deepEqual([requests[2]?.url, requests[2]?.headers.get('authorization')], ['https://relay.example.com/v1/models', `Bearer ${providerKey}`]);
  assert.equal(refreshed.refreshedAt, refreshedAt);
  // The catalog is saved only if the provider still has the revision the listing was fetched with.
  assert.deepEqual(queries.find(query => query.sql.startsWith('UPDATE ai_providers'))?.values, ['p1', 2, JSON.stringify(refreshed.models)]);
  assert.ok(queries.some(query => query.sql.includes('admin_audit_logs')));
  assert.equal(JSON.stringify(queries).includes(providerKey), false);
  saveMatches = false;
  await assert.rejects(refreshProviderCatalog(pool, 'p1', 'admin', encryptionKey), { statusCode: 409, reason: 'REVISION_CONFLICT' });
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '10.0.0.8', family: 4 }]);
  await assert.rejects(refreshProviderCatalog(pool, 'p1', 'admin', encryptionKey), { reason: 'DISCOVERY_ENDPOINT_INVALID' });
  assert.equal(requests.length, 4);
  globalThis.fetch = async () => new Response('{"error":"bad key secret"}', { status: 401 });
  await assert.rejects(probeProviderModels({ protocol: 'openai', apiKey: providerKey }), (error: Error & { reason?: string }) =>
    error.reason === 'DISCOVERY_AUTH_FAILED' && !error.message.includes('secret'));
  globalThis.fetch = async () => { throw new Error('network'); };
  await assert.rejects(probeProviderModels({ protocol: 'openai', apiKey: providerKey }), { reason: 'DISCOVERY_UNREACHABLE' });
  await assert.rejects(probeProviderModels({ protocol: 'openai', baseUrl: 'https://10.0.0.8/v1', apiKey: providerKey }), { reason: 'BASE_URL_INVALID' });
});

test('model discovery distinguishes header, connection and body timeouts from invalid responses without leaking credentials', async t => {
  const timeout = new DOMException('provider echoed private-test-key', 'TimeoutError');
  const fetchMock = t.mock.method(globalThis, 'fetch', async (): Promise<Response> => { throw timeout; });
  const input = { protocol: 'openai', apiKey: providerKey };
  const isSafeTimeout = (error: unknown) => {
    const failure = error as Error & { reason?: string };
    return failure.reason === 'DISCOVERY_TIMEOUT' && !failure.message.includes(providerKey);
  };
  await assert.rejects(probeProviderModels(input), isSafeTimeout);

  fetchMock.mock.mockImplementation(async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('connection timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });
  });
  await assert.rejects(probeProviderModels(input), isSafeTimeout);

  fetchMock.mock.mockImplementation(async () => new Response(new ReadableStream({
    start(controller) { controller.error(timeout); },
  })));
  await assert.rejects(probeProviderModels(input), isSafeTimeout);

  fetchMock.mock.mockImplementation(async () => new Response('{invalid json'));
  await assert.rejects(probeProviderModels(input), { reason: 'DISCOVERY_BAD_RESPONSE' });
});
