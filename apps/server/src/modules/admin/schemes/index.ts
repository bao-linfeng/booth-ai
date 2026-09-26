import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createScheme, deleteScheme, getScheme, listSchemes, updateScheme, type ListSchemesOptions, type SchemeInput } from './service.js';

interface SchemeQuery extends Partial<ListSchemesOptions> {}
interface CodeParams { code: string; }
interface UpdateBody extends SchemeInput { expectedRevision: number; }

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableStringArray = { type: ['array', 'null'], items: { type: 'string' } };
const schemeProperties = {
  code: { type: 'string', minLength: 1, maxLength: 200 },
  name: { type: 'string', minLength: 1, maxLength: 500 },
  parentCode: nullableString,
  lengthCm: nullableNumber,
  widthCm: nullableNumber,
  heightCm: nullableNumber,
  areaSqm: nullableNumber,
  openingCount: { type: ['integer', 'null'], minimum: 0 },
  openingDirections: nullableStringArray,
  productLine: nullableString,
  style: nullableString,
  industries: nullableStringArray,
  budgetTier: nullableString,
  functionalZones: nullableStringArray,
  keyFeatures: nullableStringArray,
  description: nullableString,
  keywords: nullableStringArray,
  source: nullableString,
  visualTheme: nullableString,
  applicableConditions: { type: ['object', 'null'], additionalProperties: true },
  publishStatus: { type: 'string', enum: ['draft', 'published', 'unpublished'] },
  verificationStatus: { type: 'string', enum: ['unverified', 'verified', 'failed'] },
  notes: nullableString,
};

const updateProperties = {
  name: { type: 'string', minLength: 1, maxLength: 500 },
  parentCode: nullableString,
  lengthCm: nullableNumber,
  widthCm: nullableNumber,
  heightCm: nullableNumber,
  areaSqm: nullableNumber,
  openingCount: { type: ['integer', 'null'], minimum: 0 },
  openingDirections: nullableStringArray,
  productLine: nullableString,
  style: nullableString,
  industries: nullableStringArray,
  budgetTier: nullableString,
  functionalZones: nullableStringArray,
  keyFeatures: nullableStringArray,
  description: nullableString,
  keywords: nullableStringArray,
  source: nullableString,
  visualTheme: nullableString,
  applicableConditions: { type: ['object', 'null'], additionalProperties: true },
  publishStatus: { type: 'string', enum: ['draft', 'published', 'unpublished'] },
  verificationStatus: { type: 'string', enum: ['unverified', 'verified', 'failed'] },
  notes: nullableString,
  expectedRevision: { type: 'integer', minimum: 0 },
};

const codeParamsSchema = {
  type: 'object', required: ['code'], additionalProperties: false,
  properties: { code: { type: 'string', minLength: 1 } },
};

const listQuerySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    code: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, style: { type: 'string', minLength: 1 },
    industry: { type: 'string', minLength: 1 }, productLine: { type: 'string', minLength: 1 },
    publishStatus: { type: 'string', enum: ['draft', 'published', 'unpublished'] },
    verificationStatus: { type: 'string', enum: ['unverified', 'verified', 'failed'] }, parentCode: { type: 'string', minLength: 1 },
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
    ...(query.code ? { code: query.code.trim() } : {}),
    ...(query.name ? { name: query.name.trim() } : {}),
    ...(query.style ? { style: query.style } : {}),
    ...(query.industry ? { industry: query.industry } : {}),
    ...(query.productLine ? { productLine: query.productLine } : {}),
    ...(query.publishStatus ? { publishStatus: query.publishStatus } : {}),
    ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
    ...(query.parentCode ? { parentCode: query.parentCode } : {}),
  };
}

export async function registerAdminSchemesRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  // TODO(P1): enforce admin session authentication and pass the authenticated admin id.
  const adminId: string | null = null;
  app.get('/schemes', { schema: { tags: ['admin-schemes'], querystring: listQuerySchema } }, async request => {
    return { code: 0, data: await listSchemes(pool, listOptions(request.query as SchemeQuery)) };
  });
  app.get('/schemes/:code', { schema: { tags: ['admin-schemes'], params: codeParamsSchema } }, async request => {
    return { code: 0, data: await getScheme(pool, decodedCode(request.params as CodeParams)) };
  });
  app.post('/schemes', {
    schema: { tags: ['admin-schemes'], body: { type: 'object', required: ['code', 'name'], additionalProperties: false, properties: schemeProperties } },
  }, async request => {
    return { code: 0, data: await createScheme(pool, adminId, request.body as SchemeInput) };
  });
  app.put('/schemes/:code', {
    schema: { tags: ['admin-schemes'], params: codeParamsSchema, body: { type: 'object', required: ['expectedRevision'], additionalProperties: false, properties: updateProperties } },
  }, async request => {
    const { expectedRevision, ...input } = request.body as UpdateBody;
    return { code: 0, data: await updateScheme(pool, decodedCode(request.params as CodeParams), adminId, input, expectedRevision) };
  });
  app.delete('/schemes/:code', { schema: { tags: ['admin-schemes'], params: codeParamsSchema } }, async (request) => {
    await deleteScheme(pool, decodedCode(request.params as CodeParams));
    return { code: 0, data: null };
  });
}

