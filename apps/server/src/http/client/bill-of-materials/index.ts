import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { bomError } from '../../../modules/schemes/bill-of-materials/errors.js';
import { getBom } from '../../../modules/schemes/bill-of-materials/repository.js';
import { assertCurrentPublishedBom, assertSchemePublished } from '../../../modules/schemes/bill-of-materials/publication.js';
import { exportBomWorkbook } from '../../../modules/schemes/bill-of-materials/workbook.js';

interface CodeParams {
  code: string;
}
interface DownloadQuery {
  revision: string;
}

const params = { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1 } } };
const querystring = {
  type: 'object',
  required: ['revision'],
  additionalProperties: false,
  properties: { revision: { type: 'string', pattern: '^[1-9][0-9]*$' } },
};

function code(request: FastifyRequest<{ Params: CodeParams }>): string {
  const raw = request.params.code;
  if (!raw || raw.length > 500) throw bomError('INVALID_INPUT', 400);
  return raw;
}

async function noStore(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header('Cache-Control', 'no-store');
}

export async function registerClientBomRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get<{ Params: CodeParams }>(
    '/schemes/:code/bill-of-materials',
    {
      onRequest: noStore,
      schema: { tags: ['client-bill-of-materials'], params },
    },
    async request => {
      const schemeCode = code(request);
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
      };
    },
  );

  app.get<{ Params: CodeParams; Querystring: DownloadQuery }>(
    '/schemes/:code/bill-of-materials/download',
    {
      onRequest: noStore,
      schema: { tags: ['client-bill-of-materials'], params, querystring },
    },
    async (request, reply) => {
      const schemeCode = code(request);
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
