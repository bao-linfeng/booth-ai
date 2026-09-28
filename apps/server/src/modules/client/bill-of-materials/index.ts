import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { getSession } from '../../../infra/session.js';
import { bomError, getBom } from '../../admin/bill-of-materials/service.js';
import { exportBomWorkbook } from '../../admin/bill-of-materials/workbook.js';

interface CodeParams { code: string }
interface DownloadQuery { revision: string }

const params = { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1 } } };
const querystring = { type: 'object', required: ['revision'], additionalProperties: false, properties: { revision: { type: 'string', pattern: '^[1-9][0-9]*$' } } };
const conversionDescriptions = {
  identity: '原单位计价，×1',
  mm_to_m: '已核对总长度由毫米换算为米，除以1000',
  mm2_to_m2: '已核对总面积由平方毫米换算为平方米，除以1000000',
} as const;

function code(request: FastifyRequest<{ Params: CodeParams }>): string {
  const raw = request.params.code;
  if (!raw || raw.length > 500) throw bomError('INVALID_INPUT', 400);
  return raw;
}

async function assertPublished(pool: pg.Pool, schemeCode: string): Promise<void> {
  const row = (await pool.query('SELECT 1 FROM schemes WHERE code = $1 AND publish_status = $2', [schemeCode, 'published'])).rows[0];
  if (!row) throw bomError('RESOURCE_NOT_FOUND', 404);
}

async function noStore(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header('Cache-Control', 'private, no-store');
}

async function assertCurrentPublishedBom(pool: pg.Pool, schemeCode: string, revision: number): Promise<void> {
  const row = (await pool.query<{ publishStatus: string; revision: number | null; status: string | null }>(
    `SELECT s.publish_status AS "publishStatus", b.revision, b.status
     FROM schemes s LEFT JOIN scheme_boms b ON b.scheme_id = s.id
     WHERE s.code = $1`,
    [schemeCode],
  )).rows[0];
  if (!row || row.publishStatus !== 'published') throw bomError('RESOURCE_NOT_FOUND', 404);
  if (row.revision !== revision || row.status !== 'verified') throw bomError('BOM_REVISION_CHANGED', 409);
}

export async function registerClientBomRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  const requireClientSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
    const session = token ? await getSession(redis, token, 'client') : null;
    if (!session) {
      reply.code(401).send({ error: { code: 'AUTH_REQUIRED', reason: 'AUTH_REQUIRED', message: 'Authentication required', requestId: request.id } });
      return;
    }
  };

  app.get<{ Params: CodeParams }>('/schemes/:code/bill-of-materials', {
    onRequest: noStore,
    preHandler: requireClientSession,
    schema: { tags: ['client-bill-of-materials'], params },
  }, async request => {
    const schemeCode = code(request);
    const bom = await getBom(pool, schemeCode);
    await assertPublished(pool, schemeCode);
    if (!bom || bom.status !== 'verified') throw bomError('BOM_NOT_AVAILABLE', 409);

    return {
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
        erpCode: item.erpCode,
        unitRuleId: item.unitRuleId,
      })),
      unitRules: bom.unitRules.map(rule => ({
        id: rule.id,
        measurementKind: rule.measurementKind,
        sourceUnit: rule.sourceUnit,
        pricingUnit: rule.pricingUnit,
        conversionDescription: conversionDescriptions[rule.conversionCode],
      })),
    };
  });

  app.get<{ Params: CodeParams; Querystring: DownloadQuery }>('/schemes/:code/bill-of-materials/download', {
    onRequest: noStore,
    preHandler: requireClientSession,
    schema: { tags: ['client-bill-of-materials'], params, querystring },
  }, async (request, reply) => {
    const schemeCode = code(request);
    const requested = Number(request.query.revision);
    if (!Number.isSafeInteger(requested) || requested <= 0) throw bomError('INVALID_INPUT', 400);
    const bom = await getBom(pool, schemeCode);
    await assertPublished(pool, schemeCode);
    if (!bom || bom.status !== 'verified') throw bomError('BOM_NOT_AVAILABLE', 409);
    if (bom.revision !== requested) throw bomError('BOM_REVISION_CHANGED', 409);

    const file = await exportBomWorkbook(bom, schemeCode);
    await assertCurrentPublishedBom(pool, schemeCode, requested);

    const filename = encodeURIComponent(`${schemeCode.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')}@简化清单.xlsx`);
    return reply.header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(file);
  });
}
