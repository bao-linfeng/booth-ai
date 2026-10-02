import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { requirementSchema } from '../../selection/domain.js';
import { quoteSchema } from '../quote-requests/schema.js';
import { text } from '../../projects/schema.js';
import { requireProjectUser } from '../quote-requests/index.js';
import { createManualProject } from '../../projects/service.js';
import { projectError, type ManualInput } from '../../projects/domain.js';

export async function registerClientManualRequestRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  const excluded=new Set(['schemeCode','schemeRevision','bomRevision','drawingRevision','artworkRevision','themeSelection','requirementContext']);
  const properties={...Object.fromEntries(Object.entries(quoteSchema.properties).filter(([key])=>!excluded.has(key))),
    originalDescription:text(5000,1),parsedRequirements:requirementSchema,confirmedRequirements:requirementSchema,
    unresolvedQuestions:{type:'array',maxItems:30,items:text(1000,1)}};
  app.post<{Body:ManualInput}>('/manual-requests',{schema:{tags:['client-manual-requests'],body:{type:'object',additionalProperties:false,
    required:[...quoteSchema.required.filter(key=>!excluded.has(key)),'originalDescription','confirmedRequirements'],properties}}},async(request,reply)=>{
      reply.header('Cache-Control','private, no-store');
      const userId=await requireProjectUser(request.headers.authorization,pool,redis);
      const count=await redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],60) end; return n',1,`manual-rate:${userId}:${Math.floor(Date.now()/60000)}`);
      if(Number(count)>10){reply.header('Retry-After','60');throw projectError('RATE_LIMITED',429);}
      const result=await createManualProject(pool,userId,request.body);
      return reply.code(result.replayed?200:201).send({code:0,data:result.receipt});
    });
}
