import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createScheme, deleteScheme, getScheme, listSchemes, updateScheme, type ListSchemesOptions, type SchemeInput } from './service.js';

interface SchemeQuery extends Partial<ListSchemesOptions> {}
interface CodeParams { code: string; }
interface UpdateBody extends SchemeInput { editRevision: number; }

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableStringArray = { type: ['array', 'null'], items: { type: 'string' } };
const dictionaryId = { type: ['string', 'null'], format: 'uuid' };
const dictionaryIds = { type: 'array', uniqueItems: true, items: { type: 'string', format: 'uuid' } };
const applicabilityConditions = {
  type: ['object', 'null'], additionalProperties: false,
  required: ['status', 'rules', 'labelsConfirmed', 'publicNotes'],
  properties: {
    status: { type: 'string', enum: ['pending', 'confirmed'] },
    rules: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false,
      required: ['id', 'expectedValue'], properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, expectedValue: { type: 'boolean' } } } },
    labelsConfirmed: { type: 'boolean' },
    publicNotes: { type: 'string', maxLength: 2000 },
  },
};
const schemeProperties = {
  code: { type: 'string', minLength: 1, maxLength: 200 },
  name: { type: 'string', minLength: 1, maxLength: 500 },
  parentCode: nullableString,
  lengthMm: { type: ['integer', 'null'], minimum: 1 },
  widthMm: { type: ['integer', 'null'], minimum: 1 },
  heightMm: { type: ['integer', 'null'], minimum: 1 },
  areaM2: nullableNumber,
  openingCount: { type: ['integer', 'null'], minimum: 0 },
  openSides: { type: ['array', 'null'], uniqueItems: true, items: { type: 'string', enum: ['front', 'right', 'back', 'left'] } },
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
  applicableConditions: applicabilityConditions,
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
  openSides: schemeProperties.openSides,
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
  applicableConditions: applicabilityConditions,
  notes: nullableString,
  editRevision: { type: 'integer', minimum: 1 },
};

const codeParamsSchema = {
  type: 'object', required: ['code'], additionalProperties: false,
  properties: { code: { type: 'string', minLength: 1 } },
};

const listQuerySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    code: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, styleId: { type: 'string', format: 'uuid' },
    industryId: { type: 'string', format: 'uuid' }, productSystemId: { type: 'string', format: 'uuid' },
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
    ...(query.styleId ? { styleId: query.styleId } : {}),
    ...(query.industryId ? { industryId: query.industryId } : {}),
    ...(query.productSystemId ? { productSystemId: query.productSystemId } : {}),
    ...(query.publishStatus ? { publishStatus: query.publishStatus } : {}),
    ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
    ...(query.parentCode ? { parentCode: query.parentCode } : {}),
  };
}

export async function registerAdminSchemesRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  // TODO(P1): enforce admin session authentication and pass the authenticated admin id.
  const adminId: string | null = null;
  app.get('/schemes/options', { schema: { tags: ['admin-schemes'] } }, async () => {
    const result = await pool.query<{ code: string; id: string; label: string; itemValue: string }>(`
      SELECT d.code, i.id::text AS id, i.item_label AS label, i.item_value AS "itemValue" FROM dictionaries d
      JOIN dictionary_items i ON i.dictionary_id = d.id
       WHERE d.enabled AND i.enabled AND d.code IN ('opening_count','booth_length','booth_width','booth_height','booth_area','product_system','style','industry','budget_tier','functional_zone','key_feature')
      ORDER BY d.code, i.sort_order, i.id`);
    return { code: 0, data: result.rows.reduce<Record<string, { id: string; label: string; itemValue: string }[]>>((options, item) => {
      (options[item.code] ??= []).push({ id: item.id, label: item.label, itemValue: item.itemValue });
      return options;
    }, {}) };
  });
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
    schema: { tags: ['admin-schemes'], params: codeParamsSchema, body: { type: 'object', required: ['editRevision'], additionalProperties: false, properties: updateProperties } },
  }, async request => {
    const { editRevision, ...input } = request.body as UpdateBody;
    return { code: 0, data: await updateScheme(pool, decodedCode(request.params as CodeParams), adminId, input, editRevision) };
  });
  app.delete('/schemes/:code', { schema: { tags: ['admin-schemes'], params: codeParamsSchema } }, async (request) => {
    await deleteScheme(pool, decodedCode(request.params as CodeParams));
    return { code: 0, data: null };
  });
}
