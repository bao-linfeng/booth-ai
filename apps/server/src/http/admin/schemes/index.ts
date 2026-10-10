import type { FastifyInstance } from 'fastify';
import type { TypeProvider } from '../../type-provider.js';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import {
  createScheme,
  deleteScheme,
  getScheme,
  listSchemes,
  schemeFormOptions,
  updateScheme,
  type ListSchemesOptions,
} from '../../../modules/schemes/service.js';
import { nullDataResponse, pageSchema, successResponse } from '../../schemas.js';

const nullableString = { type: ['string', 'null'] } as const;
const nullableNumber = { type: ['number', 'null'] } as const;
const nullableStringArray = { type: ['array', 'null'], items: { type: 'string' } } as const;
const dictionaryId = { type: ['string', 'null'], format: 'uuid' } as const;
const dictionaryIds = { type: 'array', uniqueItems: true, items: { type: 'string', format: 'uuid' } } as const;
const schemeProperties = {
  code: { type: 'string', minLength: 1, maxLength: 200 },
  name: { type: 'string', minLength: 1, maxLength: 500 },
  parentCode: nullableString,
  lengthMm: { type: ['integer', 'null'], minimum: 1 },
  widthMm: { type: ['integer', 'null'], minimum: 1 },
  heightMm: { type: ['integer', 'null'], minimum: 1 },
  areaM2: nullableNumber,
  openingCount: { type: ['integer', 'null'], minimum: 0 },
  productSystemId: dictionaryId,
  styleId: dictionaryId,
  industryIds: dictionaryIds,
  budgetTierId: dictionaryId,
  zoneIds: dictionaryIds,
  featureIds: dictionaryIds,
  description: nullableString,
  keywords: nullableStringArray,
  source: nullableString,
  visualTheme: nullableString,
  notes: nullableString,
} as const;

const updateProperties = {
  name: { type: 'string', minLength: 1, maxLength: 500 },
  parentCode: nullableString,
  lengthMm: schemeProperties.lengthMm,
  widthMm: schemeProperties.widthMm,
  heightMm: schemeProperties.heightMm,
  areaM2: nullableNumber,
  openingCount: { type: ['integer', 'null'], minimum: 0 },
  productSystemId: dictionaryId,
  styleId: dictionaryId,
  industryIds: dictionaryIds,
  budgetTierId: dictionaryId,
  zoneIds: dictionaryIds,
  featureIds: dictionaryIds,
  description: nullableString,
  keywords: nullableStringArray,
  source: nullableString,
  visualTheme: nullableString,
  notes: nullableString,
  editRevision: { type: 'integer', minimum: 1 },
} as const;

const codeParamsSchema = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: { code: { type: 'string', minLength: 1 } },
} as const;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    keyword: { type: 'string', minLength: 1 },
    code: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    styleId: { type: 'string', format: 'uuid' },
    industryId: { type: 'string', format: 'uuid' },
    productSystemId: { type: 'string', format: 'uuid' },
    publishStatus: { type: 'string', enum: ['draft', 'published', 'unpublished'] },
    verificationStatus: { type: 'string', enum: ['unverified', 'verified', 'failed'] },
    openingCount: { type: 'integer', minimum: 1, maximum: 4 },
    budgetTierId: { type: 'string', format: 'uuid' },
    zoneIds: { type: 'array', items: { type: 'string', format: 'uuid' }, uniqueItems: true },
    featureIds: { type: 'array', items: { type: 'string', format: 'uuid' }, uniqueItems: true },
    parentCode: { type: 'string', minLength: 1 },
    sortBy: { type: 'string', enum: ['updatedAt', 'createdAt'] },
    sortOrder: { type: 'string', enum: ['asc', 'desc'] },
  },
} as const;

const string = { type: 'string' } as const;
const strings = { type: 'array', items: string } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;
const schemeSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'code',
    'name',
    'parentCode',
    'lengthMm',
    'widthMm',
    'heightMm',
    'areaM2',
    'openingCount',
    'productSystemId',
    'styleId',
    'industryIds',
    'budgetTierId',
    'zoneIds',
    'featureIds',
    'description',
    'keywords',
    'source',
    'visualTheme',
    'publishStatus',
    'verificationStatus',
    'notes',
    'editRevision',
    'createdBy',
    'updatedBy',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: string,
    code: string,
    name: string,
    parentCode: nullableString,
    lengthMm: nullableInteger,
    widthMm: nullableInteger,
    heightMm: nullableInteger,
    areaM2: { ...nullableString, description: '面积（平方米），以字符串返回避免精度丢失' },
    openingCount: nullableInteger,
    productSystemId: nullableString,
    styleId: nullableString,
    industryIds: strings,
    budgetTierId: nullableString,
    zoneIds: strings,
    featureIds: strings,
    description: nullableString,
    keywords: { type: ['array', 'null'], items: string },
    source: nullableString,
    visualTheme: nullableString,
    publishStatus: string,
    verificationStatus: string,
    notes: nullableString,
    editRevision: { type: 'integer' },
    createdBy: nullableString,
    updatedBy: nullableString,
    createdAt: string,
    updatedAt: string,
  },
} as const;
const optionItem = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'itemValue'],
  properties: { id: string, label: string, itemValue: string },
} as const;
const schemeResponse = { 200: successResponse(schemeSchema) } as const;

function decodedCode(code: string): string {
  try {
    return decodeURIComponent(code);
  } catch {
    throw Object.assign(new Error('Invalid scheme code'), { statusCode: 400 });
  }
}

function listOptions(query: Partial<ListSchemesOptions>): ListSchemesOptions {
  return {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    ...(query.keyword?.trim() ? { keyword: query.keyword.trim() } : {}),
    ...(query.code ? { code: query.code.trim() } : {}),
    ...(query.name ? { name: query.name.trim() } : {}),
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.industryId ? { industryId: query.industryId } : {}),
    ...(query.productSystemId ? { productSystemId: query.productSystemId } : {}),
    ...(query.publishStatus ? { publishStatus: query.publishStatus } : {}),
    ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
    ...(query.openingCount !== undefined ? { openingCount: query.openingCount } : {}),
    ...(query.budgetTierId ? { budgetTierId: query.budgetTierId } : {}),
    ...(query.zoneIds && query.zoneIds.length > 0 ? { zoneIds: query.zoneIds } : {}),
    ...(query.featureIds && query.featureIds.length > 0 ? { featureIds: query.featureIds } : {}),
    ...(query.parentCode ? { parentCode: query.parentCode } : {}),
    ...(query.sortBy ? { sortBy: query.sortBy } : {}),
    ...(query.sortOrder ? { sortOrder: query.sortOrder } : {}),
  };
}

export async function registerAdminSchemesRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/schemes/options',
    {
      config: { permissions: ['schemes.read'] },
      schema: {
        tags: ['admin-schemes'],
        response: {
          200: successResponse({
            type: 'object',
            additionalProperties: { type: 'array', items: optionItem },
            description: '按字典编码分组的选项',
          }),
        },
      },
    },
    async () => ({ code: 0, data: await schemeFormOptions(pool) }) as const,
  );
  routes.get(
    '/schemes',
    {
      config: { permissions: ['schemes.read'] },
      schema: { tags: ['admin-schemes'], querystring: listQuerySchema, response: { 200: successResponse(pageSchema(schemeSchema)) } },
    },
    async request => ({ code: 0, data: await listSchemes(pool, listOptions(request.query)) }) as const,
  );
  routes.get(
    '/schemes/:code',
    { config: { permissions: ['schemes.read'] }, schema: { tags: ['admin-schemes'], params: codeParamsSchema, response: schemeResponse } },
    async request => ({ code: 0, data: await getScheme(pool, decodedCode(request.params.code)) }) as const,
  );
  routes.post(
    '/schemes',
    {
      config: { permissions: ['schemes.create'] },
      schema: {
        tags: ['admin-schemes'],
        body: { type: 'object', required: ['code', 'name'], additionalProperties: false, properties: schemeProperties },
        response: schemeResponse,
      },
    },
    async request => ({ code: 0, data: await createScheme(pool, adminUserId(request), request.body) }) as const,
  );
  routes.put(
    '/schemes/:code',
    {
      config: { permissions: ['schemes.update'] },
      schema: {
        tags: ['admin-schemes'],
        params: codeParamsSchema,
        body: { type: 'object', required: ['editRevision'], additionalProperties: false, properties: updateProperties },
        response: schemeResponse,
      },
    },
    async request => {
      const { editRevision, ...input } = request.body;
      return {
        code: 0,
        data: await updateScheme(pool, decodedCode(request.params.code), adminUserId(request), input, editRevision),
      } as const;
    },
  );
  routes.delete(
    '/schemes/:code',
    {
      config: { permissions: ['schemes.delete'] },
      schema: {
        tags: ['admin-schemes'],
        params: codeParamsSchema,
        response: { 200: nullDataResponse },
      },
    },
    async request => {
      await deleteScheme(pool, adminUserId(request), decodedCode(request.params.code));
      return { code: 0, data: null } as const;
    },
  );
}
