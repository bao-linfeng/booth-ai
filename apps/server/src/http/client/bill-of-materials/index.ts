import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { measurementKindSchema } from '../../bom-schemas.js';
import { fileResponse, successResponse } from '../../schemas.js';
import { bomError } from '../../../modules/schemes/bill-of-materials/errors.js';
import { getBom } from '../../../modules/schemes/bill-of-materials/repository.js';
import { assertCurrentPublishedBom, assertSchemePublished } from '../../../modules/schemes/bill-of-materials/publication.js';
import { exportBomWorkbook } from '../../../modules/schemes/bill-of-materials/workbook.js';

const params = { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1 } } } as const;
const querystring = {
  type: 'object',
  required: ['revision'],
  additionalProperties: false,
  properties: { revision: { type: 'string', pattern: '^[1-9][0-9]*$' } },
} as const;
const nullableString = { type: ['string', 'null'] } as const;

// 参展商只看到已核验清单的公开字段（不含单价、总价与导入来源）
const publicBomSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemeCode', 'revision', 'status', 'verifiedAt', 'items'],
  properties: {
    schemeCode: { type: 'string' },
    revision: { type: 'integer' },
    status: { type: 'string', const: 'verified' },
    verifiedAt: nullableString,
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'ordinal',
          'productName',
          'productModel',
          'specificationMm',
          'quantity',
          'sourceUnit',
          'erpCode',
          'totalWeightKg',
          'measurementKind',
        ],
        properties: {
          id: { type: 'string' },
          ordinal: { type: 'integer' },
          productName: { type: 'string' },
          productModel: nullableString,
          specificationMm: nullableString,
          quantity: { type: 'string' },
          sourceUnit: { type: 'string' },
          erpCode: nullableString,
          totalWeightKg: nullableString,
          measurementKind: measurementKindSchema,
        },
      },
    },
  },
} as const;

function code(raw: string): string {
  if (!raw || raw.length > 500) throw bomError('INVALID_INPUT', 400);
  return raw;
}

async function noStore(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header('Cache-Control', 'no-store');
}

export async function registerClientBomRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.withTypeProvider<TypeProvider>().get(
    '/schemes/:code/bill-of-materials',
    {
      onRequest: noStore,
      schema: { tags: ['client-bill-of-materials'], params, response: { 200: successResponse(publicBomSchema) } },
    },
    async request => {
      const schemeCode = code(request.params.code);
      await assertSchemePublished(pool, schemeCode);
      const bom = await getBom(pool, schemeCode);
      if (!bom || bom.status !== 'verified') throw bomError('BOM_NOT_AVAILABLE', 409);

      return {
        code: 0,
        data: {
          schemeCode,
          revision: bom.revision,
          status: 'verified',
          verifiedAt: bom.verifiedAt,
          items: bom.items.map(item => ({
            id: item.id,
            ordinal: item.ordinal,
            productName: item.productName,
            productModel: item.productModel,
            specificationMm: item.specificationMm,
            quantity: item.quantity,
            sourceUnit: item.sourceUnit,
            erpCode: item.erpCode,
            totalWeightKg: item.totalWeightKg,
            measurementKind: item.measurementKind,
          })),
        },
      } as const;
    },
  );

  // 文件下载不走类型化的响应（Buffer 不经 JSON 序列化）
  app.get<{ Params: { code: string }; Querystring: { revision: string } }>(
    '/schemes/:code/bill-of-materials/download',
    {
      onRequest: noStore,
      schema: { tags: ['client-bill-of-materials'], params, querystring, response: fileResponse('xlsx') },
    },
    async (request, reply) => {
      const schemeCode = code(request.params.code);
      const requested = Number(request.query.revision);
      if (!Number.isSafeInteger(requested) || requested <= 0) throw bomError('INVALID_INPUT', 400);
      await assertSchemePublished(pool, schemeCode);
      const bom = await getBom(pool, schemeCode);
      if (!bom || bom.status !== 'verified') throw bomError('BOM_NOT_AVAILABLE', 409);
      if (bom.revision !== requested) throw bomError('BOM_REVISION_CHANGED', 409);

      const file = await exportBomWorkbook(bom, schemeCode);
      await assertCurrentPublishedBom(pool, schemeCode, requested);

      const filename = encodeURIComponent(`${schemeCode.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')}@简化清单.xlsx`);
      return reply
        .header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(file);
    },
  );
}
