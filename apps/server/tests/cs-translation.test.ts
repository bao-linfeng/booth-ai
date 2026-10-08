import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type pg from 'pg';
import { protectTokens, restoreTokens, translateMessage, translationMessages } from '../src/modules/customer-service/translation.js';
import { activeModel } from './ai-fixtures.js';

test('number protection replaces project, conversation, request and scheme codes plus digit runs with placeholders', () => {
  const requestNo = 'QR-0A1B2C3D-0000-4000-8000-00000000ABCD';
  const source = `项目 PJ-00000012 会话 CS-00000003 申请 ${requestNo} 方案 S-01A 尺寸 6x3 共 2 面`;
  const { text, tokens } = protectTokens(source, ['S-01A']);
  assert.deepEqual(tokens, ['PJ-00000012', 'CS-00000003', requestNo, 'S-01A', '6', '3', '2']);
  assert.doesNotMatch(text.replace(/⟦\d+⟧/g, ''), /\d/);
  assert.equal(restoreTokens(text, tokens), source);
  assert.equal(restoreTokens('⟦1⟧ then ⟦0⟧ ⟦2⟧ ⟦3⟧ ⟦4⟧x⟦5⟧ ⟦6⟧', tokens), `CS-00000003 then PJ-00000012 ${requestNo} S-01A 6x3 2`);
  assert.throws(() => restoreTokens('⟦0⟧ ⟦1⟧', tokens), { code: 'PLACEHOLDER_MISMATCH' });
  assert.throws(() => restoreTokens(text.replace('⟦6⟧', '⟦5⟧'), tokens), { code: 'PLACEHOLDER_MISMATCH' });
  assert.throws(() => restoreTokens(`${text} ⟦7⟧`, tokens), { code: 'PLACEHOLDER_MISMATCH' });
  assert.deepEqual(protectTokens('no numbers'), { text: 'no numbers', tokens: [] });
  const [system] = translationMessages('x', 'ja', 'zh');
  assert.match(system!.content, /日本語.*简体中文/);
  assert.match(system!.content, /⟦n⟧/);
});

function fakePool(t: TestContext, options: { status?: string } = {}) {
  const state = { status: options.status ?? 'pending', body: null as string | null, modelId: null as string | null, attempts: 0, error: null as string | null };
  const pool = { query: async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM cs_message_translations t JOIN cs_messages m')) {
      return { rows: [{ body: '请确认 PJ-00000012 的 2 面开口', locale: 'zh', seq: '7', senderType: 'agent', conversationId: 'c1', customerLocale: 'ja',
        status: state.status, agentAdminId: 'a1', conversationStatus: 'active', schemeCodes: [] }] };
    }
    if (sql.includes("SET status='done'")) { Object.assign(state, { status: 'done', body: params[2], modelId: params[3] }); state.attempts++; return { rowCount: 1, rows: [] }; }
    if (sql.includes("SET status='failed'")) { Object.assign(state, { status: 'failed', error: params[2] }); return { rowCount: 1, rows: [] }; }
    if (sql.includes('SET attempts=attempts+1')) { state.attempts++; state.error = params[2] as string; return { rowCount: 1, rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as pg.Pool;
  const published: { channel: string; payload: Record<string, unknown> }[] = [];
  const redis = { publish: async (channel: string, payload: string) => { published.push({ channel, payload: JSON.parse(payload) }); return 1; } };
  const answers: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: string; messages: { role: string; content: string }[] };
    assert.equal(body.messages[1]!.content, '请确认 ⟦0⟧ 的 ⟦1⟧ 面开口');
    const answer = answers.shift();
    return answer === undefined ? new Response('down', { status: 503 }) : Response.json({ choices: [{ message: { content: answer } }] });
  });
  return { pool, redis, state, published, answers };
}

const models = ['primary', 'backup'].map((name, index) => activeModel('openai', 'cs_translation', { model: name, position: index + 1 }));

test('placeholder loss falls back to the next model; the translation is published to the customer and the workbench', async t => {
  const { pool, redis, state, published, answers } = fakePool(t);
  answers.push('⟦0⟧ を確認してください', '⟦0⟧ の ⟦1⟧ 面の開口をご確認ください');
  assert.equal(await translateMessage(pool, 'key', redis, 'm1', 'ja', models), 'done');
  assert.equal(state.status, 'done');
  assert.equal(state.body, 'PJ-00000012 の 2 面の開口をご確認ください');
  assert.equal(state.modelId, models[1]!.id);
  assert.deepEqual(published.map(item => [item.channel, item.payload.type]), [['cs:conv:c1', 'message.translated'], ['cs:agents', 'message.translated']]);
  assert.deepEqual(published[0]!.payload.translation, { locale: 'ja', status: 'done', body: state.body });
  assert.equal(published[1]!.payload.agentAdminId, 'a1');
});

test('when every model fails the attempt is recorded and the error is rethrown for queue retries; missing models fail immediately', async t => {
  const { pool, redis, state, published } = fakePool(t);
  await assert.rejects(translateMessage(pool, 'key', redis, 'm1', 'ja', models));
  assert.equal(state.status, 'pending');
  assert.equal(state.attempts, 1);
  assert.equal(published.length, 0);
  assert.equal(await translateMessage(pool, 'key', redis, 'm1', 'ja', []), 'unavailable');
  assert.equal(state.status, 'failed');
  assert.equal(state.error, 'MODEL_UNAVAILABLE');
  assert.deepEqual(published[0]!.payload.translation, { locale: 'ja', status: 'failed', body: null });
});

test('already finished translations are skipped without calling a model', async t => {
  const { pool, redis, published } = fakePool(t, { status: 'done' });
  assert.equal(await translateMessage(pool, 'key', redis, 'm1', 'ja', models), 'skipped');
  assert.equal(published.length, 0);
});
