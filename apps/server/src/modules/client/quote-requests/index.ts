import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { getSession } from '../../../infra/session.js';
import { createQuoteRequest } from '../../projects/service.js';
import { projectError, type QuoteInput } from '../../projects/domain.js';
import { captureScheme } from '../../projects/snapshot.js';
import { transaction } from '../../../infra/database.js';
import { quoteSchema } from './schema.js';

export async function requireProjectUser(authorization: string | undefined, pool: pg.Pool, redis: Redis): Promise<string> {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
  const session = token ? await getSession(redis,token,'client') : null;
  if (!session) throw projectError('AUTH_REQUIRED',401);
  const user = (await pool.query<{ enabled: boolean }>('SELECT enabled FROM users WHERE id=$1',[session.localId])).rows[0];
  if (!user?.enabled) throw projectError('ACCESS_DENIED',403);
  return session.localId;
}
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
  app.post<{ Body: QuoteInput }>('/quote-requests',{ schema: { tags: ['client-quote-requests'], body: quoteSchema } },async (request,reply) => {
    reply.header('Cache-Control','private, no-store');
    const userId = await requireProjectUser(request.headers.authorization,pool,redis);
    const count = await redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],60) end; return n',1,`quote-rate:${userId}:${Math.floor(Date.now()/60000)}`);
    if (Number(count)>10) { reply.header('Retry-After','60'); throw projectError('RATE_LIMITED',429); }
    const result = await createQuoteRequest(pool,userId,request.body);
    return reply.code(result.replayed ? 200 : 201).send({ code: 0, data: result.receipt });
  });
}
