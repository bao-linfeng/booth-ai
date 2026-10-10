import type { FastifyInstance } from 'fastify';
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
  type SchemeInput,
} from '../../../modules/schemes/service.js';

interface SchemeQuery extends Partial<ListSchemesOptions> {}
interface CodeParams {
  code: string;
}
interface UpdateBody extends SchemeInput {
  editRevision: number;
}

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableStringArray = { type: ['array', 'null'], items: { type: 'string' } };
const dictionaryId = { type: ['string', 'null'], format: 'uuid' };
const dictionaryIds = { type: 'array', uniqueItems: true, items: { type: 'string', format: 'uuid' } };
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
};

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
};

const codeParamsSchema = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: { code: { type: 'string', minLength: 1 } },
};

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
};

function decodedCode(params: CodeParams): string {
  try {
    return decodeURIComponent(params.code);
  } catch {
    throw Object.assign(new Error('Invalid scheme code'), { statusCode: 400 });
  }
}

function listOptions(query: SchemeQuery): ListSchemesOptions {
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
  app.get('/schemes/options', { config: { permissions: ['schemes.read'] }, schema: { tags: ['admin-schemes'] } }, async () => ({
    code: 0,
    data: await schemeFormOptions(pool),
  }));
  app.get(
    '/schemes',
    { config: { permissions: ['schemes.read'] }, schema: { tags: ['admin-schemes'], querystring: listQuerySchema } },
    async request => {
      return { code: 0, data: await listSchemes(pool, listOptions(request.query as SchemeQuery)) };
    },
  );
  app.get(
    '/schemes/:code',
    { config: { permissions: ['schemes.read'] }, schema: { tags: ['admin-schemes'], params: codeParamsSchema } },
    async request => {
      return { code: 0, data: await getScheme(pool, decodedCode(request.params as CodeParams)) };
    },
  );
  app.post(
    '/schemes',
    {
      config: { permissions: ['schemes.create'] },
      schema: {
        tags: ['admin-schemes'],
        body: { type: 'object', required: ['code', 'name'], additionalProperties: false, properties: schemeProperties },
      },
    },
    async request => {
      return { code: 0, data: await createScheme(pool, adminUserId(request), request.body as SchemeInput) };
    },
  );
  app.put(
    '/schemes/:code',
    {
      config: { permissions: ['schemes.update'] },
      schema: {
        tags: ['admin-schemes'],
        params: codeParamsSchema,
        body: { type: 'object', required: ['editRevision'], additionalProperties: false, properties: updateProperties },
      },
    },
    async request => {
      const { editRevision, ...input } = request.body as UpdateBody;
      return {
        code: 0,
        data: await updateScheme(pool, decodedCode(request.params as CodeParams), adminUserId(request), input, editRevision),
      };
    },
  );
  app.delete(
    '/schemes/:code',
    { config: { permissions: ['schemes.delete'] }, schema: { tags: ['admin-schemes'], params: codeParamsSchema } },
    async request => {
      await deleteScheme(pool, adminUserId(request), decodedCode(request.params as CodeParams));
      return { code: 0, data: null };
    },
  );
}
