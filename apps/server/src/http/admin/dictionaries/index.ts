import type { FastifyInstance } from 'fastify';
import type { TypeProvider } from '../../type-provider.js';
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
} from '../../../modules/dictionaries/service.js';
import { nullDataResponse, pageSchema, successResponse } from '../../schemas.js';

const idSchema = { type: 'string', format: 'uuid' } as const;
const paramsSchema = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: idSchema } } as const;
const itemParamsSchema = {
  type: 'object',
  required: ['id', 'itemId'],
  additionalProperties: false,
  properties: { id: idSchema, itemId: idSchema },
} as const;
const querySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    code: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    type: { type: 'string', minLength: 1 },
    enabled: { type: 'boolean' },
  },
} as const;
const dictionaryProperties = {
  code: { type: 'string', minLength: 1 },
  name: { type: 'string', minLength: 1 },
  type: { type: 'string', minLength: 1 },
  description: { type: ['string', 'null'] },
  enabled: { type: 'boolean' },
  sortOrder: { type: 'integer' },
} as const;
const itemProperties = {
  itemValue: { type: 'string', minLength: 1 },
  itemLabel: { type: 'string', minLength: 1 },
  description: { type: ['string', 'null'] },
  enabled: { type: 'boolean' },
  sortOrder: { type: 'integer' },
  labels: {
    type: 'object',
    maxProperties: 30,
    propertyNames: { pattern: '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$' },
    additionalProperties: { type: 'string', minLength: 1, maxLength: 200 },
  },
  aliases: {
    type: 'array',
    maxItems: 100,
    items: {
      type: 'object',
      required: ['locale', 'text'],
      additionalProperties: false,
      properties: {
        locale: { type: 'string', pattern: '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$' },
        text: { type: 'string', minLength: 1, maxLength: 200 },
      },
    },
  },
} as const;
const dictionaryCreateSchema = {
  type: 'object',
  required: ['code', 'name', 'type'],
  additionalProperties: false,
  properties: dictionaryProperties,
} as const;
const dictionaryUpdateSchema = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    name: dictionaryProperties.name,
    description: dictionaryProperties.description,
    enabled: dictionaryProperties.enabled,
    sortOrder: dictionaryProperties.sortOrder,
  },
} as const;
const itemCreateSchema = {
  type: 'object',
  required: ['itemValue', 'itemLabel'],
  additionalProperties: false,
  properties: itemProperties,
} as const;
const itemUpdateSchema = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    itemLabel: itemProperties.itemLabel,
    description: itemProperties.description,
    enabled: itemProperties.enabled,
    sortOrder: itemProperties.sortOrder,
    labels: itemProperties.labels,
    aliases: itemProperties.aliases,
  },
} as const;

const string = { type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const integer = { type: 'integer' } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;
const dictionaryRecordProperties = {
  id: string,
  code: string,
  name: string,
  type: string,
  description: nullableString,
  enabled: { type: 'boolean' },
  sortOrder: integer,
  itemCount: integer,
  createdAt: string,
  updatedAt: string,
} as const;
const dictionaryRecordRequired = ['id', 'code', 'name', 'type', 'description', 'enabled', 'sortOrder', 'createdAt', 'updatedAt'] as const;
const dictionarySchema = {
  type: 'object',
  additionalProperties: false,
  required: dictionaryRecordRequired,
  properties: dictionaryRecordProperties,
} as const;
const itemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'dictionaryId',
    'itemValue',
    'itemLabel',
    'labels',
    'aliases',
    'lengthMm',
    'widthMm',
    'heightMm',
    'description',
    'enabled',
    'sortOrder',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: string,
    dictionaryId: string,
    itemValue: string,
    itemLabel: string,
    labels: { type: 'object', additionalProperties: string, description: '按语言代码的显示名称' },
    aliases: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['locale', 'text'], properties: { locale: string, text: string } },
    },
    lengthMm: nullableInteger,
    widthMm: nullableInteger,
    heightMm: nullableInteger,
    description: nullableString,
    enabled: { type: 'boolean' },
    sortOrder: integer,
    createdAt: string,
    updatedAt: string,
  },
} as const;
const dictionaryDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...dictionaryRecordRequired, 'items'],
  properties: { ...dictionaryRecordProperties, items: { type: 'array', items: itemSchema } },
} as const;

export async function registerAdminDictionariesRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const tags = ['admin-dictionaries'];
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/dictionaries',
    {
      config: { permissions: ['dictionaries.read'] },
      schema: { tags, querystring: querySchema, response: { 200: successResponse(pageSchema(dictionarySchema)) } },
    },
    async request => {
      const query = request.query;
      return {
        code: 0,
        data: await listDictionaries(pool, {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 20,
          ...(query.code !== undefined ? { code: query.code.trim() } : {}),
          ...(query.name !== undefined ? { name: query.name.trim() } : {}),
          ...(query.type !== undefined ? { type: query.type.trim() } : {}),
          ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
        }),
      } as const;
    },
  );
  routes.get(
    '/dictionaries/:id',
    {
      config: { permissions: ['dictionaries.read'] },
      schema: { tags, params: paramsSchema, response: { 200: successResponse(dictionaryDetailSchema) } },
    },
    async request => {
      return { code: 0, data: await getDictionary(pool, request.params.id) } as const;
    },
  );
  routes.post(
    '/dictionaries',
    {
      config: { permissions: ['dictionaries.create'] },
      schema: { tags, body: dictionaryCreateSchema, response: { 200: successResponse(dictionarySchema) } },
    },
    async request => {
      return { code: 0, data: await createDictionary(pool, request.body) } as const;
    },
  );
  routes.put(
    '/dictionaries/:id',
    {
      config: { permissions: ['dictionaries.update'] },
      schema: { tags, params: paramsSchema, body: dictionaryUpdateSchema, response: { 200: successResponse(dictionarySchema) } },
    },
    async request => {
      return { code: 0, data: await updateDictionary(pool, request.params.id, request.body) } as const;
    },
  );
  routes.delete(
    '/dictionaries/:id',
    { config: { permissions: ['dictionaries.delete'] }, schema: { tags, params: paramsSchema, response: { 200: nullDataResponse } } },
    async request => {
      await deleteDictionary(pool, request.params.id);
      return { code: 0, data: null } as const;
    },
  );
  routes.get(
    '/dictionaries/:id/items',
    {
      config: { permissions: ['dictionaries.read'] },
      schema: { tags, params: paramsSchema, response: { 200: successResponse({ type: 'array', items: itemSchema }) } },
    },
    async request => {
      return { code: 0, data: await listDictionaryItems(pool, request.params.id) } as const;
    },
  );
  routes.post(
    '/dictionaries/:id/items',
    {
      config: { permissions: ['dictionaries.item-create'] },
      schema: { tags, params: paramsSchema, body: itemCreateSchema, response: { 200: successResponse(itemSchema) } },
    },
    async request => {
      return { code: 0, data: await createDictionaryItem(pool, request.params.id, request.body) } as const;
    },
  );
  routes.put(
    '/dictionaries/:id/items/:itemId',
    {
      config: { permissions: ['dictionaries.item-update'] },
      schema: { tags, params: itemParamsSchema, body: itemUpdateSchema, response: { 200: successResponse(itemSchema) } },
    },
    async request => {
      const { id, itemId } = request.params;
      return { code: 0, data: await updateDictionaryItem(pool, itemId, request.body, id) } as const;
    },
  );
  routes.delete(
    '/dictionaries/:id/items/:itemId',
    {
      config: { permissions: ['dictionaries.item-delete'] },
      schema: { tags, params: itemParamsSchema, response: { 200: nullDataResponse } },
    },
    async request => {
      const { id, itemId } = request.params;
      await deleteDictionaryItem(pool, itemId, id);
      return { code: 0, data: null } as const;
    },
  );
}
