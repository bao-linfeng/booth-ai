import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TypeProvider } from '../../type-provider.js';
import type pg from 'pg';
import { createStorage } from '../../../infra/storage.js';
import { adminUserId } from '../../authentication.js';
import { readUploadedFile, workbookUploadMaxBytes } from '../../uploads.js';
import { bomError } from '../../../modules/schemes/bill-of-materials/errors.js';
import { assertImportBaseline, createBomImport, createOrReplaceBomFromImport } from '../../../modules/schemes/bill-of-materials/imports.js';
import { deleteBom, deleteBomItem, updateBomItems } from '../../../modules/schemes/bill-of-materials/items.js';
import { getBom, listBoms } from '../../../modules/schemes/bill-of-materials/repository.js';
import { submitBomVerification } from '../../../modules/schemes/bill-of-materials/verification.js';
import { exportBomWorkbook, parseBomWorkbook } from '../../../modules/schemes/bill-of-materials/workbook.js';
import { bomItemSchema, bomRecordSchema, measurementKindSchema } from '../../bom-schemas.js';
import { fileResponse, nullDataResponse, successResponse } from '../../schemas.js';

const params = { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1 } } } as const;
const withImport = {
  type: 'object',
  required: ['code', 'importId'],
  properties: { code: { type: 'string', minLength: 1 }, importId: { type: 'string', format: 'uuid' } },
} as const;
const withItem = {
  type: 'object',
  required: ['code', 'itemId'],
  properties: { code: { type: 'string', minLength: 1 }, itemId: { type: 'string', format: 'uuid' } },
} as const;
const decimal = { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,6})?$' } as const;
const reason = { type: 'string', minLength: 1, maxLength: 1000 } as const;
const revision = { type: 'integer', minimum: 1 } as const;
const itemSchema = {
  type: 'object',
  required: ['productName', 'sourceQuantity', 'sourceUnit', 'measurementKind'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    productName: { type: 'string', minLength: 1, maxLength: 500 },
    productModel: { type: ['string', 'null'] },
    specificationMm: { type: ['string', 'null'] },
    sourceQuantity: decimal,
    sourceUnit: { type: 'string', minLength: 1 },
    measurementKind: { type: 'string', enum: ['count', 'length', 'area'] },
    erpCode: { type: ['string', 'null'] },
    unitPrice: { ...decimal, type: ['string', 'null'] },
    totalPrice: { ...decimal, type: ['string', 'null'] },
    totalWeightKg: { ...decimal, type: ['string', 'null'] },
    diffNote: { type: ['string', 'null'] },
    sourceSheet: { type: ['string', 'null'] },
    sourceRow: { type: ['integer', 'null'], minimum: 1 },
  },
} as const;
function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw bomError('INVALID_INPUT', 400);
  }
}
const string = { type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const integer = { type: 'integer' } as const;
const issueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: { code: string, sheet: string, row: integer, field: string, message: string },
} as const;
const listItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemeCode', 'schemeName', 'revision', 'status', 'itemCount', 'updatedAt'],
  properties: {
    schemeCode: string,
    schemeName: string,
    revision: integer,
    status: { type: 'string', enum: ['pending_verification', 'verified', 'rejected'] },
    itemCount: integer,
    updatedAt: string,
  },
} as const;
const importPreviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'importId',
    'schemeCode',
    'baseRevision',
    'mappingRevision',
    'expiresAt',
    'status',
    'sourceFileName',
    'sourceHash',
    'canCommit',
    'items',
    'errors',
    'warnings',
  ],
  properties: {
    importId: string,
    schemeCode: string,
    baseRevision: integer,
    mappingRevision: integer,
    expiresAt: string,
    status: { type: 'string', enum: ['ready', 'invalid', 'committed', 'expired'] },
    sourceFileName: string,
    sourceHash: string,
    canCommit: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ordinal', 'productName', 'sourceQuantity', 'sourceUnit', 'measurementKind'],
        properties: {
          ordinal: integer,
          id: string,
          productName: string,
          productModel: nullableString,
          specificationMm: nullableString,
          sourceQuantity: string,
          sourceUnit: string,
          measurementKind: measurementKindSchema,
          erpCode: nullableString,
          unitPrice: nullableString,
          totalPrice: nullableString,
          totalWeightKg: nullableString,
          sourceSheet: nullableString,
          sourceRow: { type: ['integer', 'null'] },
          diffNote: nullableString,
        },
      },
    },
    errors: { type: 'array', items: issueSchema },
    warnings: { type: 'array', items: issueSchema },
  },
} as const;
const commitResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemeCode', 'revision', 'status', 'itemCount', 'unpublished'],
  properties: {
    schemeCode: string,
    revision: integer,
    status: { type: 'string', enum: ['pending_verification', 'verified', 'rejected'] },
    itemCount: integer,
    unpublished: { type: 'boolean', description: '覆盖清单导致已发布方案退回草稿' },
  },
} as const;
const absentBomSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemeCode', 'revision', 'status', 'items'],
  properties: {
    schemeCode: string,
    revision: integer,
    status: { type: 'string', const: 'absent' },
    items: { type: 'array', maxItems: 0, items: bomItemSchema },
  },
} as const;
const verificationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verificationId', 'revision', 'status', 'verifiedAt'],
  properties: {
    verificationId: string,
    revision: integer,
    status: { type: 'string', enum: ['pending_verification', 'verified', 'rejected'] },
    verifiedAt: nullableString,
  },
} as const;
const bomResponse = { 200: successResponse(bomRecordSchema) } as const;

function parseInteger(value: unknown): number {
  const parsed = typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed)) throw bomError('INVALID_INPUT', 400);
  return parsed;
}
export async function registerAdminBomRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  storage: ReturnType<typeof createStorage>,
): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/bill-of-materials',
    {
      config: { permissions: ['bom.read'] },
      schema: {
        tags: ['admin-bill-of-materials'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string' },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
        response: {
          200: successResponse({
            type: 'object',
            additionalProperties: false,
            required: ['data', 'total'],
            properties: { data: { type: 'array', items: listItemSchema }, total: integer },
          }),
        },
      },
    },
    async request => ({ code: 0, data: await listBoms(pool, request.query) }) as const,
  );
  routes.post(
    '/schemes/:code/bill-of-materials/imports',
    {
      config: { permissions: ['bom.import'] },
      schema: { tags: ['admin-bill-of-materials'], params, response: { 201: successResponse(importPreviewSchema) } },
    },
    async (request, reply) => {
      let file: Buffer | undefined;
      let filename = '';
      let mime = '';
      let expected: number | undefined;
      for await (const part of request.parts({ limits: { fileSize: workbookUploadMaxBytes } })) {
        if (part.type === 'file') {
          if (file || part.fieldname !== 'file') throw bomError('INVALID_INPUT', 400);
          filename = basename(part.filename.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '');
          mime = part.mimetype.toLowerCase();
          file = await readUploadedFile(part);
        } else if (part.fieldname === 'expectedRevision' && expected === undefined) expected = parseInteger(part.value);
        else throw bomError('INVALID_INPUT', 400);
      }
      if (!file || expected === undefined) throw bomError('INVALID_INPUT', 400);
      if (
        !/\.xls[xm]$/i.test(filename) ||
        ![
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel.sheet.macroenabled.12',
          'application/octet-stream',
        ].includes(mime) ||
        file.subarray(0, 4).toString('hex') !== '504b0304'
      )
        throw bomError('INVALID_WORKBOOK', 415);
      const schemeCode = decode(request.params.code);
      await assertImportBaseline(pool, schemeCode, expected);
      const parsed = await parseBomWorkbook(file, schemeCode);
      const objectKey = `schemes/${encodeURIComponent(schemeCode)}/bom-imports/${randomUUID()}_${filename}`;
      await storage.putBuffer(objectKey, file, mime);
      try {
        const imported = await createBomImport(
          pool,
          adminUserId(request),
          schemeCode,
          filename,
          createHash('sha256').update(file).digest('hex'),
          objectKey,
          file.length,
          expected,
          parsed,
        );
        return reply.code(201).send({
          code: 0,
          data: {
            importId: imported.id,
            schemeCode,
            baseRevision: imported.baseRevision,
            mappingRevision: imported.mappingRevision,
            expiresAt: imported.expiresAt,
            status: imported.status,
            sourceFileName: filename,
            sourceHash: imported.sourceHash,
            canCommit: imported.canCommit,
            items: parsed.items.map((item, index) => ({ ...item, ordinal: index + 1 })),
            errors: parsed.errors,
            warnings: parsed.warnings,
          },
        });
      } catch (error) {
        await storage.deleteObject(objectKey).catch(() => {});
        throw error;
      }
    },
  );
  routes.post(
    '/schemes/:code/bill-of-materials/imports/:importId/commit',
    {
      config: { permissions: ['bom.import'] },
      schema: {
        tags: ['admin-bill-of-materials'],
        params: withImport,
        body: {
          type: 'object',
          required: ['expectedRevision'],
          additionalProperties: false,
          properties: { expectedRevision: { type: 'integer', minimum: 0 } },
        },
        response: { 200: successResponse(commitResultSchema) },
      },
    },
    async request =>
      ({
        code: 0,
        data: await createOrReplaceBomFromImport(
          pool,
          adminUserId(request),
          decode(request.params.code),
          request.params.importId,
          request.body.expectedRevision,
        ),
      }) as const,
  );
  routes.get(
    '/schemes/:code/bill-of-materials',
    {
      config: { permissions: ['bom.read'] },
      schema: {
        tags: ['admin-bill-of-materials'],
        params,
        response: { 200: successResponse({ anyOf: [bomRecordSchema, absentBomSchema], description: '尚未导入清单时 status 为 absent' }) },
      },
    },
    async request =>
      ({
        code: 0,
        data: (await getBom(pool, decode(request.params.code))) ?? {
          schemeCode: decode(request.params.code),
          revision: 0,
          status: 'absent',
          items: [],
        },
      }) as const,
  );
  routes.delete(
    '/schemes/:code/bill-of-materials',
    {
      config: { permissions: ['bom.delete'] },
      schema: {
        tags: ['admin-bill-of-materials'],
        params,
        querystring: {
          type: 'object',
          required: ['expectedRevision'],
          additionalProperties: false,
          properties: { expectedRevision: revision },
        },
        response: { 200: nullDataResponse },
      },
    },
    async request => {
      await deleteBom(pool, adminUserId(request), decode(request.params.code), request.query.expectedRevision);
      return { code: 0, data: null } as const;
    },
  );
  routes.put(
    '/schemes/:code/bill-of-materials/items',
    {
      config: { permissions: ['bom.update'] },
      schema: {
        tags: ['admin-bill-of-materials'],
        params,
        body: {
          type: 'object',
          required: ['expectedRevision', 'changeReason', 'items'],
          additionalProperties: false,
          properties: {
            expectedRevision: revision,
            changeReason: reason,
            items: { type: 'array', minItems: 1, maxItems: 10000, items: itemSchema },
          },
        },
        response: bomResponse,
      },
    },
    async request => {
      const body = request.body;
      return {
        code: 0,
        data: await updateBomItems(
          pool,
          adminUserId(request),
          decode(request.params.code),
          body.expectedRevision,
          body.changeReason,
          body.items,
        ),
      } as const;
    },
  );
  routes.delete(
    '/schemes/:code/bill-of-materials/items/:itemId',
    {
      config: { permissions: ['bom.delete-item'] },
      schema: {
        tags: ['admin-bill-of-materials'],
        params: withItem,
        querystring: {
          type: 'object',
          required: ['expectedRevision'],
          additionalProperties: false,
          properties: { expectedRevision: revision },
        },
        response: bomResponse,
      },
    },
    async request =>
      ({
        code: 0,
        data: await deleteBomItem(
          pool,
          adminUserId(request),
          decode(request.params.code),
          request.params.itemId,
          request.query.expectedRevision,
        ),
      }) as const,
  );
  routes.post(
    '/schemes/:code/bill-of-materials/verifications',
    {
      config: { permissions: ['bom.verify'] },
      schema: {
        tags: ['admin-bill-of-materials'],
        params,
        body: {
          type: 'object',
          required: ['requestKey', 'expectedRevision', 'decision'],
          additionalProperties: false,
          properties: {
            requestKey: { type: 'string', minLength: 1, maxLength: 200 },
            expectedRevision: revision,
            decision: { type: 'string', enum: ['pass', 'reject'] },
            notes: { type: 'string', maxLength: 1000 },
          },
        },
        response: { '2xx': successResponse(verificationSchema) },
      },
    },
    async (request, reply) => {
      const { replayed, ...result } = await submitBomVerification(pool, adminUserId(request), decode(request.params.code), request.body);
      return reply.code(replayed ? 200 : 201).send({ code: 0, data: result });
    },
  );
  app.get<{ Params: { code: string }; Querystring: { revision: number } }>(
    '/schemes/:code/bill-of-materials/download',
    {
      config: { permissions: ['bom.download'] },
      schema: {
        tags: ['admin-bill-of-materials'],
        params,
        querystring: { type: 'object', required: ['revision'], additionalProperties: false, properties: { revision } },
        response: fileResponse('xlsx'),
      },
    },
    async (request, reply) => {
      const schemeCode = decode(request.params.code);
      const requested = request.query.revision;
      const bom = await getBom(pool, schemeCode);
      if (!bom || bom.status !== 'verified') throw bomError('BOM_NOT_AVAILABLE', 409);
      if (bom.revision !== requested) throw bomError('BOM_REVISION_CHANGED', 409);
      const file = await exportBomWorkbook(bom, schemeCode);
      const current = await getBom(pool, schemeCode);
      if (current?.revision !== requested || current.status !== 'verified') throw bomError('BOM_REVISION_CHANGED', 409);
      const name = encodeURIComponent(`${schemeCode.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}@简化清单.xlsx`);
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${name}`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(file);
    },
  );
}
