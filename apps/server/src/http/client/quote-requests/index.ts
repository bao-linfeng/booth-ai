import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { clientUserId } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import { createQuoteRequest } from '../../../modules/projects/service.js';
import type { QuoteInput } from '../../../modules/projects/domain.js';
import { captureScheme } from '../../../modules/projects/snapshot.js';
import { transaction } from '../../../infra/database.js';
import { quoteSchema } from './schema.js';

export async function registerQuoteRequestRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis) {
  app.get<{ Params: { code: string } }>('/schemes/:code/quote-context', {
    schema: { params: { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 200 } } } },
  }, async (request,reply) => {
    reply.header('Cache-Control','private, no-store');
    const context = await transaction(pool,client => captureScheme(client,{ schemeCode: request.params.code },null));
    return { code: 0, data: { schemeCode: context.snapshot.code, schemeRevision: context.snapshot.revision, bomRevision: context.materials.bom.revision,
      drawingRevision: context.materials.drawings.revision, artworkRevision: context.materials.artworks.revision,
      materialsStatus: { bom: context.materials.bom.status, drawings: context.materials.drawings.status, artworks: context.materials.artworks.status } } };
  });
  app.post<{ Body: QuoteInput }>('/quote-requests',{ preHandler: rateLimit(redis, 'quote'), schema: { tags: ['client-quote-requests'], body: quoteSchema } },async (request,reply) => {
    reply.header('Cache-Control','private, no-store');
    const userId = clientUserId(request);
    const result = await createQuoteRequest(pool,userId,request.body);
    return reply.code(result.replayed ? 200 : 201).send({ code: 0, data: result.receipt });
  });
}
