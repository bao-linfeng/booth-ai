import type { FastifyInstance } from 'fastify';
import type { TypeProvider } from '../../type-provider.js';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import { readUploadedFile, workbookUploadMaxBytes } from '../../uploads.js';
import { commitImport } from '../../../modules/schemes/imports/commit.js';
import { previewImport } from '../../../modules/schemes/imports/preview.js';
import { buildImportTemplate } from '../../../modules/schemes/imports/template.js';
import { domainError } from '../../../lib/errors.js';
import { fileResponse, successResponse } from '../../schemas.js';

const string = { type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const integer = { type: 'integer' } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;
const nullableStrings = { type: ['array', 'null'], items: string } as const;
const fieldName = {
  type: 'string',
  enum: [
    'name',
    'parentCode',
    'widthMm',
    'lengthMm',
    'areaM2',
    'heightMm',
    'openingCount',
    'productSystemId',
    'styleId',
    'industryIds',
    'budgetTierId',
    'zoneIds',
    'featureIds',
    'description',
    'keywords',
    'notes',
  ],
} as const;
const importRowSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'code',
    'name',
    'parentCode',
    'widthMm',
    'lengthMm',
    'areaM2',
    'heightMm',
    'openingCount',
    'productSystemId',
    'styleId',
    'industryIds',
    'budgetTierId',
    'zoneIds',
    'featureIds',
    'description',
    'keywords',
    'verificationStatus',
    'notes',
  ],
  properties: {
    code: string,
    name: string,
    parentCode: nullableString,
    widthMm: nullableInteger,
    lengthMm: nullableInteger,
    areaM2: { type: ['number', 'null'] },
    heightMm: nullableInteger,
    openingCount: nullableInteger,
    productSystemId: nullableString,
    styleId: nullableString,
    industryIds: nullableStrings,
    budgetTierId: nullableString,
    zoneIds: nullableStrings,
    featureIds: nullableStrings,
    description: nullableString,
    keywords: nullableStrings,
    verificationStatus: { type: 'string', enum: ['unverified', 'verified', 'failed'] },
    notes: nullableString,
  },
} as const;
const previewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['importId', 'expiresAt', 'rows', 'summary'],
  properties: {
    importId: string,
    expiresAt: string,
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sheetName', 'rowNumber', 'rowId', 'code', 'name', 'status'],
        properties: {
          sheetName: string,
          rowNumber: integer,
          rowId: integer,
          code: string,
          name: string,
          status: { type: 'string', enum: ['valid', 'duplicate', 'unchanged', 'error'] },
          reason: string,
          data: importRowSchema,
          dictionaryLabels: { type: 'object', additionalProperties: { type: 'array', items: string } },
          snapshotRevision: integer,
          published: { type: 'boolean' },
          changedFields: { type: 'array', items: fieldName },
          clearedFields: { type: 'array', items: fieldName },
        },
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'valid', 'duplicate', 'unchanged', 'error', 'skipped', 'unpublish'],
      properties: {
        total: integer,
        valid: integer,
        duplicate: integer,
        unchanged: integer,
        error: integer,
        skipped: integer,
        unpublish: integer,
      },
    },
  },
} as const;
const commitResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['created', 'updated', 'unchanged', 'dictionaryItemsCreated', 'failed'],
  properties: {
    created: integer,
    updated: integer,
    unchanged: integer,
    dictionaryItemsCreated: integer,
    failed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sheetName', 'rowNumber', 'rowId', 'code', 'reason'],
        properties: { sheetName: string, rowNumber: integer, rowId: integer, code: string, reason: string },
      },
    },
  },
} as const;

export async function registerAdminSchemeImportsRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  app.get(
    '/scheme-imports/template',
    {
      config: { permissions: ['schemes.import'] },
      schema: { tags: ['admin-scheme-imports'], summary: '下载与当前解析规则和启用字典一致的方案导入模板', response: fileResponse('xlsx') },
    },
    async (_request, reply) => {
      const file = await buildImportTemplate(pool);
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('方案导入模板.xlsx')}`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(file);
    },
  );

  routes.post(
    '/scheme-imports',
    {
      config: { permissions: ['schemes.import'] },
      schema: { tags: ['admin-scheme-imports'], response: { 200: successResponse(previewSchema) } },
    },
    async request => {
      const data = await request.file({ limits: { fileSize: workbookUploadMaxBytes } });
      if (!data) throw domainError('FILE_REQUIRED', 400);
      const lowerFilename = data.filename.toLowerCase();
      if (!lowerFilename.endsWith('.xlsx')) throw domainError('UNSUPPORTED_FILE_TYPE', 400);
      const buffer = await readUploadedFile(data);
      const adminId = adminUserId(request);
      const result = await previewImport(pool, adminId, buffer, data.filename);
      return { code: 0, data: result } as const;
    },
  );

  routes.post(
    '/scheme-imports/:importId/commit',
    {
      config: { permissions: ['schemes.import'] },
      schema: {
        tags: ['admin-scheme-imports'],
        params: {
          type: 'object',
          required: ['importId'],
          additionalProperties: false,
          properties: { importId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['duplicateStrategy'],
          additionalProperties: false,
          properties: {
            duplicateStrategy: { type: 'string', enum: ['skip', 'update'] },
            selectedRowIds: { type: 'array', items: { type: 'integer', minimum: 1 }, uniqueItems: true },
          },
        },
        response: { 200: successResponse(commitResultSchema) },
      },
    },
    async request => {
      const adminId = adminUserId(request);
      return { code: 0, data: await commitImport(pool, adminId, request.params.importId, request.body) } as const;
    },
  );
}
