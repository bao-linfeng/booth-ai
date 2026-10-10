import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import {
  createDictionary,
  createDictionaryItem,
  deleteDictionary,
  deleteDictionaryItem,
  getDictionary,
  listDictionaries,
  listDictionaryItems,
  updateDictionary,
  updateDictionaryItem,
} from '../../src/modules/dictionaries/service.js';

const dictionary = {
  id: 'dictionary-id',
  code: 'gender',
  name: 'Gender',
  type: 'default',
  description: null,
  enabled: true,
  sortOrder: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};
const item = {
  id: 'item-id',
  dictionaryId: dictionary.id,
  itemValue: 'm',
  itemLabel: 'Male',
  description: null,
  enabled: true,
  sortOrder: 0,
  createdAt: dictionary.createdAt,
  updatedAt: dictionary.updatedAt,
};

function poolFor(query: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number }): pg.Pool {
  return { query: async (sql: string, params?: unknown[]) => query(sql, params) } as unknown as pg.Pool;
}

test('dictionary list filters and paginates with item count', async () => {
  const pool = poolFor((sql, params) => {
    assert.deepEqual(params, sql.includes('LIMIT') ? ['%gen%', '%Gender%', '尺寸', false, 10, 10] : ['%gen%', '%Gender%', '尺寸', false]);
    assert.match(sql, /d\.type = \$3/);
    assert.match(sql, /d\.enabled = \$4/);
    if (sql.includes('LIMIT')) {
      assert.match(sql, /d\.type/);
      return { rows: [{ ...dictionary, type: '尺寸', itemCount: 2 }] };
    }
    return { rows: [{ total: '1' }] };
  });
  const result = await listDictionaries(pool, { page: 2, pageSize: 10, code: 'gen', name: 'Gender', type: '尺寸', enabled: false });
  assert.equal(result.total, 1);
  assert.equal(result.data[0]?.itemCount, 2);
  assert.equal(result.data[0]?.type, '尺寸');
  assert.equal(result.data[0]?.createdAt, '2026-01-01T00:00:00.000Z');
});

test('dictionary detail includes ordered items and missing dictionary returns 404', async () => {
  const pool = poolFor(sql => {
    if (sql.includes('FROM dictionaries WHERE id')) return { rows: [dictionary] };
    if (sql.includes('FROM dictionary_items')) return { rows: [item] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const detail = await getDictionary(pool, dictionary.id);
  assert.equal(detail.type, 'default');
  assert.equal(detail.items[0]?.itemValue, 'm');
  assert.equal(detail.items[0]?.createdAt, '2026-01-01T00:00:00.000Z');
  await assert.rejects(
    getDictionary(
      poolFor(() => ({ rows: [] })),
      'missing',
    ),
    { statusCode: 404 },
  );
  await assert.rejects(
    listDictionaryItems(
      poolFor(() => ({ rows: [], rowCount: 0 })),
      'missing',
    ),
    { statusCode: 404 },
  );
});

test('dictionary CRUD trims fields, rejects duplicate code and detects missing deletion', async () => {
  const pool = poolFor((sql, params) => {
    if (sql.startsWith('INSERT')) {
      assert.deepEqual(params, ['gender', 'Gender', '尺寸']);
      assert.match(sql, /\btype\b/);
      return { rows: [{ ...dictionary, type: '尺寸' }] };
    }
    if (sql.startsWith('UPDATE')) {
      assert.deepEqual(params, ['Updated', false, dictionary.id]);
      return { rows: [{ ...dictionary, name: 'Updated', enabled: false }] };
    }
    if (sql.startsWith('SELECT code FROM dictionaries')) return { rows: [{ code: 'gender' }] };
    if (sql.includes('JOIN schemes s ON')) return { rows: [{ used: false }] };
    if (sql.startsWith('DELETE')) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  assert.equal((await createDictionary(pool, { code: ' gender ', name: ' Gender ', type: '尺寸' })).type, '尺寸');
  const updated = await updateDictionary(pool, dictionary.id, { name: ' Updated ', enabled: false });
  assert.equal(updated.enabled, false);
  assert.equal(updated.type, 'default');
  await assert.rejects(updateDictionary(pool, dictionary.id, { type: '开口' }), { statusCode: 400 });
  await assert.rejects(deleteDictionary(pool, dictionary.id), { statusCode: 404 });
  const conflict = poolFor(() => {
    throw Object.assign(new Error('duplicate'), { code: '23505' });
  });
  await assert.rejects(createDictionary(conflict, { code: 'gender', name: 'Gender', type: '尺寸' }), { statusCode: 409 });
  await assert.rejects(createDictionary(pool, { code: 'gender', name: 'Gender' }), { statusCode: 400, message: 'Type is required' });
  await assert.rejects(createDictionary(pool, { code: 'gender', name: 'Gender', type: '  ' }), {
    statusCode: 400,
    message: 'Type is required',
  });
});

test('item CRUD scopes mutations to dictionary and handles foreign key and conflicts', async () => {
  const pool = poolFor((sql, params) => {
    if (sql.startsWith('SELECT code FROM dictionaries')) return { rows: [{ code: 'gender' }] };
    if (sql.includes('JOIN schemes s') && sql.includes('i.length_mm')) return { rows: [{ used: false }] };
    if (sql.startsWith('INSERT')) {
      assert.deepEqual(params, [dictionary.id, 'm', 'Male']);
      return { rows: [item] };
    }
    if (sql.startsWith('UPDATE')) {
      assert.match(sql, /AND dictionary_id = \$3/);
      assert.deepEqual(params, ['Female', item.id, dictionary.id]);
      return { rows: [{ ...item, itemLabel: 'Female' }] };
    }
    if (sql.includes('FROM schemes WHERE product_system_id')) return { rows: [{ used: false }] };
    if (sql.startsWith('DELETE')) {
      assert.deepEqual(params, [item.id, dictionary.id]);
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  assert.equal((await createDictionaryItem(pool, dictionary.id, { itemValue: ' m ', itemLabel: ' Male ' })).id, item.id);
  assert.equal((await updateDictionaryItem(pool, item.id, { itemLabel: ' Female ' }, dictionary.id)).itemLabel, 'Female');
  await assert.rejects(deleteDictionaryItem(pool, item.id, dictionary.id), { statusCode: 404 });
  const missingParent = poolFor(() => ({ rows: [] }));
  await assert.rejects(createDictionaryItem(missingParent, 'missing', { itemValue: 'm', itemLabel: 'Male' }), { statusCode: 404 });
  const conflict = poolFor(() => {
    throw Object.assign(new Error('duplicate'), { code: '23505' });
  });
  await assert.rejects(updateDictionaryItem(conflict, item.id, { itemLabel: 'm' }), { statusCode: 409 });
  await assert.rejects(updateDictionaryItem(pool, item.id, { itemValue: 'other' }), { statusCode: 400 });
});
