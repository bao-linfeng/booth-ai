import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import {
  createPromptTemplate,
  getPromptTemplate,
  listPromptTemplates,
  updatePromptTemplate,
} from '../../src/modules/prompts/management-service.js';
import { getActivePromptTemplate } from '../../src/modules/prompts/service.js';

const id = '00000000-0000-0000-0000-000000000001';
const adminId = '00000000-0000-0000-0000-000000000002';
const industryId = '00000000-0000-0000-0000-000000000003';
const styleId = '00000000-0000-0000-0000-000000000004';
const row = () => ({
  id,
  purpose: 'theme',
  industryId: null,
  styleId: null,
  body: '{{industryLabel}}',
  variables: ['industryLabel'],
  enabled: false,
  revision: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

test('prompt template list filters and pagination return only public fields', async () => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { rows: sql.includes('count(*)') ? [{ total: '12' }] : [{ ...row(), createdBy: adminId, updatedBy: adminId }] };
    },
  } as unknown as pg.Pool;
  const result = await listPromptTemplates(pool, { purpose: 'theme', enabled: false, page: 2, pageSize: 5 });
  assert.equal(result.total, 12);
  assert.deepEqual(
    calls.map(call => call.params),
    [
      ['theme', false],
      ['theme', false, 5, 5],
    ],
  );
  assert.match(calls[1]!.sql, /ORDER BY created_at DESC, id DESC/);
  assert.equal(result.items[0]?.createdAt, '2026-01-01T00:00:00.000Z');
  assert.ok(!JSON.stringify(result.items).includes('createdBy'));
  assert.ok(!calls[1]!.sql.includes('created_by'));
});

test('create defaults to disabled and update applies CAS revision', async () => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.startsWith('UPDATE')) return { rows: [{ ...row(), enabled: true, revision: 2 }] };
      return { rows: [row()] };
    },
  } as unknown as pg.Pool;
  const created = await createPromptTemplate(pool, { purpose: 'theme', body: '{{industryLabel}}' }, adminId);
  assert.equal(created.enabled, false);
  assert.deepEqual(calls[0]?.params, ['theme', null, null, '{{industryLabel}}', ['industryLabel'], adminId]);
  const updated = await updatePromptTemplate(pool, id, { enabled: true, expectedRevision: 1 }, adminId);
  assert.equal(updated.revision, 2);
  assert.match(calls[2]!.sql, /WHERE id = \$5 AND revision = \$6/);
  assert.deepEqual(calls[2]?.params, [null, ['industryLabel'], true, adminId, id, 1]);
});

test('create validates filter scope and dictionary scope before insert', async () => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  } as unknown as pg.Pool;
  await assert.rejects(() => createPromptTemplate(pool, { purpose: 'filter', body: '业务解析', industryId }, adminId), {
    reason: 'INVALID_PROMPT_SCOPE',
  });
  await assert.rejects(() => createPromptTemplate(pool, { purpose: 'theme', body: '{{industryLabel}}', industryId }, adminId), {
    reason: 'INVALID_PROMPT_SCOPE',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /FROM dictionary_items/);
});

test('update reads current detail before validating CAS and enabling', async () => {
  const calls: string[] = [];
  const pool = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM prompt_templates') && sql.includes('WHERE id')) return { rows: [{ ...row(), revision: 2 }] };
      if (sql.startsWith('UPDATE')) return { rows: [{ ...row(), revision: 3, enabled: true }] };
      return { rows: [] };
    },
  } as unknown as pg.Pool;
  const result = await updatePromptTemplate(pool, id, { enabled: true, expectedRevision: 2 }, adminId);
  assert.equal(result.revision, 3);
  assert.match(calls[0]!, /SELECT/);
  assert.match(calls[1]!, /UPDATE/);
});

test('update distinguishes missing template, stale revision, and active uniqueness conflicts', async () => {
  const stale = { query: async (sql: string) => ({ rows: sql.startsWith('UPDATE') ? [] : [row()] }) } as unknown as pg.Pool;
  await assert.rejects(() => updatePromptTemplate(stale, id, { expectedRevision: 0 }, adminId), { statusCode: 409 });
  const missing = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  await assert.rejects(() => updatePromptTemplate(missing, id, { expectedRevision: 1 }, adminId), { statusCode: 404 });
  const duplicate = {
    query: async (sql: string) => {
      if (sql.startsWith('SELECT')) return { rows: [row()] };
      throw Object.assign(new Error('unique constraint'), { code: '23505', constraint: 'prompt_templates_active_unique' });
    },
  } as unknown as pg.Pool;
  await assert.rejects(() => updatePromptTemplate(duplicate, id, { enabled: true, expectedRevision: 1 }, adminId), { statusCode: 409 });
});

test('active template lookup matches specific or global dimensions and returns null when absent', async () => {
  const calls: unknown[][] = [];
  const pool = {
    query: async (_sql: string, params: unknown[]) => {
      calls.push(params);
      return { rows: calls.length === 1 ? [{ ...row(), enabled: true }] : [] };
    },
  } as unknown as pg.Pool;
  assert.equal((await getActivePromptTemplate(pool, 'theme', industryId, styleId))?.id, id);
  assert.equal(await getActivePromptTemplate(pool, 'theme'), null);
  assert.deepEqual(calls, [
    ['theme', industryId, styleId],
    ['theme', null, null],
  ]);
  const detail = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;
  assert.equal(await getPromptTemplate(detail, id), null);
});
