import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { optionalClientUserId } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import { requestMessageLocale } from '../../locale.js';
import { createQuoteRequest, loadQuoteContext } from '../../../modules/projects/service.js';
import type { QuoteInput } from '../../../modules/projects/domain.js';
import { quoteSchema } from './schema.js';
import { resolveVisitor } from '../../../modules/customer-service/visitors.js';
import { visitorToken } from '../customer-service/visitor-cookie.js';

export async function registerQuoteRequestRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis) {
  app.get<{ Params: { code: string } }>('/schemes/:code/quote-context', {
    schema: { params: { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 200 } } } },
  }, async (request,reply) => {
    reply.header('Cache-Control','private, no-store');
    return { code: 0, data: await loadQuoteContext(pool, request.params.code) };
  });
  app.post<{ Body: QuoteInput }>('/quote-requests',{ preHandler: rateLimit(redis, 'quote', 'anonymousProject'), schema: { tags: ['client-quote-requests'], body: quoteSchema } },async (request,reply) => {
    reply.header('Cache-Control','private, no-store');
    const userId = optionalClientUserId(request);
    // 匿名提交绑定客服访客（令牌缺失或无效时照常受理），供访客以项目为上下文咨询
    const visitorId = userId ? null : await resolveVisitor(pool, visitorToken(request));
    const result = await createQuoteRequest(pool,userId,request.body,requestMessageLocale(request),visitorId);
    return reply.code(result.replayed ? 200 : 201).send({ code: 0, data: result.receipt });
  });
}
