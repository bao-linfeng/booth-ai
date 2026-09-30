import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { getAdminIdFromRequest } from '../session.js';
import { createPromptTemplate, getPromptTemplate, listPromptTemplates, updatePromptTemplate,
  type CreateTemplateInput, type UpdateTemplateInput } from './service.js';

interface ListQuery { purpose?: string; enabled?: boolean; page?: number; pageSize?: number }
interface IdParams { id: string }

const tags = ['admin-prompt-templates'];
const idSchema = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', format: 'uuid' } } };
const bodySchema = { type: 'string', minLength: 1 };
const variablesSchema = { type: 'array', items: { type: 'string' } };

export async function registerAdminPromptTemplateRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get<{ Querystring: ListQuery }>('/prompt-templates', {
    schema: { tags, querystring: { type: 'object', additionalProperties: false, properties: {
      purpose: { type: 'string', enum: ['theme', 'artwork'] }, enabled: { type: 'boolean' },
      page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    } } },
  }, async request => ({ code: 0, data: await listPromptTemplates(pool, {
    ...request.query, page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 20,
  }) }));

  app.post<{ Body: CreateTemplateInput }>('/prompt-templates', {
    schema: { tags, body: { type: 'object', additionalProperties: false, required: ['purpose', 'body'], properties: {
      purpose: { type: 'string', enum: ['theme', 'artwork'] },
      industryId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
      styleId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
      body: bodySchema, variables: variablesSchema,
    } } },
  }, async request => ({ code: 0, data: await createPromptTemplate(pool, request.body, await getAdminIdFromRequest(request, redis)) }));

  app.get<{ Params: IdParams }>('/prompt-templates/:id', { schema: { tags, params: idSchema } }, async (request, reply) => {
    const template = await getPromptTemplate(pool, request.params.id);
    if (!template) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Prompt template not found', requestId: request.id } });
    return { code: 0, data: template };
  });

  app.patch<{ Params: IdParams; Body: UpdateTemplateInput }>('/prompt-templates/:id', {
    schema: { tags, params: idSchema, body: { type: 'object', additionalProperties: false, required: ['expectedRevision'], properties: {
      body: bodySchema, variables: variablesSchema, enabled: { type: 'boolean' },
      expectedRevision: { type: 'integer', minimum: 1 },
    } } },
  }, async request => ({ code: 0, data: await updatePromptTemplate(pool, request.params.id, request.body,
    await getAdminIdFromRequest(request, redis)) }));
}
