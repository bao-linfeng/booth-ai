import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { requirementSchema } from '../../../modules/selection/domain.js';
import { quoteSchema } from '../quote-requests/schema.js';
import { text } from '../../../modules/projects/schema.js';
import { optionalClientUserId } from '../../authentication.js';
import { rateLimit } from '../../rate-limits.js';
import { requestMessageLocale } from '../../locale.js';
import { createManualProject } from '../../../modules/projects/service.js';
import type { ManualInput } from '../../../modules/projects/domain.js';

export async function registerClientManualRequestRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  const excluded=new Set(['schemeCode','schemeRevision','bomRevision','drawingRevision','artworkRevision','themeSelection','requirementContext']);
  const properties={...Object.fromEntries(Object.entries(quoteSchema.properties).filter(([key])=>!excluded.has(key))),
    originalDescription:text(5000,1),parsedRequirements:requirementSchema,confirmedRequirements:requirementSchema,
    unresolvedQuestions:{type:'array',maxItems:30,items:text(1000,1)}};
  app.post<{Body:ManualInput}>('/manual-requests',{preHandler:rateLimit(redis,'manual','anonymousProject'),schema:{tags:['client-manual-requests'],body:{type:'object',additionalProperties:false,
    required:[...quoteSchema.required.filter(key=>!excluded.has(key)),'originalDescription','confirmedRequirements'],properties}}},async(request,reply)=>{
      reply.header('Cache-Control','private, no-store');
      const userId=optionalClientUserId(request);
      const result=await createManualProject(pool,userId,request.body,requestMessageLocale(request));
      return reply.code(result.replayed?200:201).send({code:0,data:result.receipt});
    });
}
