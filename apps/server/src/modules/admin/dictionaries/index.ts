import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  createDictionary, createDictionaryItem, deleteDictionary, deleteDictionaryItem,
  getDictionary, listDictionaries, listDictionaryItems, updateDictionary, updateDictionaryItem,
  type DictionaryInput, type DictionaryItemInput, type ListDictionariesOptions,
} from './service.js';

interface DictionaryQuery extends Partial<ListDictionariesOptions> {}
interface IdParams { id: string; }
interface ItemParams extends IdParams { itemId: string; }

const idSchema = { type: 'string', format: 'uuid' };
const paramsSchema = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } };
const itemParamsSchema = { type: 'object', required: ['id', 'itemId'], additionalProperties: false, properties: { id: idSchema, itemId: idSchema } };
const querySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    code: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 }, enabled: { type: 'boolean' },
  },
};
const dictionaryProperties = {
  code: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 },
  type: { type: 'string', minLength: 1 },
  description: { type: ['string', 'null'] }, enabled: { type: 'boolean' }, sortOrder: { type: 'integer' },
};
const itemProperties = {
  itemValue: { type: 'string', minLength: 1 }, itemLabel: { type: 'string', minLength: 1 },
  description: { type: ['string', 'null'] }, enabled: { type: 'boolean' }, sortOrder: { type: 'integer' },
};
const dictionaryCreateSchema = { type: 'object', required: ['code', 'name', 'type'], additionalProperties: false, properties: dictionaryProperties };
const dictionaryUpdateSchema = { type: 'object', minProperties: 1, additionalProperties: false, properties: dictionaryProperties };
const itemCreateSchema = { type: 'object', required: ['itemValue', 'itemLabel'], additionalProperties: false, properties: itemProperties };
const itemUpdateSchema = { type: 'object', minProperties: 1, additionalProperties: false, properties: itemProperties };

export async function registerAdminDictionariesRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const tags = ['admin-dictionaries'];
  app.get('/dictionaries', { schema: { tags, querystring: querySchema } }, async request => {
    const query = request.query as DictionaryQuery;
    return { code: 0, data: await listDictionaries(pool, {
      page: query.page ?? 1, pageSize: query.pageSize ?? 20,
      ...(query.code !== undefined ? { code: query.code.trim() } : {}),
      ...(query.name !== undefined ? { name: query.name.trim() } : {}),
      ...(query.type !== undefined ? { type: query.type.trim() } : {}),
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
    }) };
  });
  app.get('/dictionaries/:id', { schema: { tags, params: paramsSchema } }, async request => {
    return { code: 0, data: await getDictionary(pool, (request.params as IdParams).id) };
  });
  app.post('/dictionaries', { schema: { tags, body: dictionaryCreateSchema } }, async request => {
    return { code: 0, data: await createDictionary(pool, request.body as DictionaryInput) };
  });
  app.put('/dictionaries/:id', { schema: { tags, params: paramsSchema, body: dictionaryUpdateSchema } }, async request => {
    return { code: 0, data: await updateDictionary(pool, (request.params as IdParams).id, request.body as DictionaryInput) };
  });
  app.delete('/dictionaries/:id', { schema: { tags, params: paramsSchema } }, async request => {
    await deleteDictionary(pool, (request.params as IdParams).id);
    return { code: 0, data: null };
  });
  app.get('/dictionaries/:id/items', { schema: { tags, params: paramsSchema } }, async request => {
    return { code: 0, data: await listDictionaryItems(pool, (request.params as IdParams).id) };
  });
  app.post('/dictionaries/:id/items', { schema: { tags, params: paramsSchema, body: itemCreateSchema } }, async request => {
    return { code: 0, data: await createDictionaryItem(pool, (request.params as IdParams).id, request.body as DictionaryItemInput) };
  });
  app.put('/dictionaries/:id/items/:itemId', { schema: { tags, params: itemParamsSchema, body: itemUpdateSchema } }, async request => {
    const { id, itemId } = request.params as ItemParams;
    return { code: 0, data: await updateDictionaryItem(pool, itemId, request.body as DictionaryItemInput, id) };
  });
  app.delete('/dictionaries/:id/items/:itemId', { schema: { tags, params: itemParamsSchema } }, async request => {
    const { id, itemId } = request.params as ItemParams;
    await deleteDictionaryItem(pool, itemId, id);
    return { code: 0, data: null };
  });
}
