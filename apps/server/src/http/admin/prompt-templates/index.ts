import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import { createPromptTemplate, getPromptTemplate, listPromptTemplates, updatePromptTemplate,
  type CreateTemplateInput, type UpdateTemplateInput } from '../../../modules/prompts/management-service.js';
import { promptDefinitions, previewPrompt, type PreviewInput } from '../../../modules/prompt-preview/service.js';
import { PROMPT_PURPOSES, type PromptIssue } from '../../../modules/prompts/template.js';

interface ListQuery { purpose?: string; industryId?: string; styleId?: string; enabled?: boolean; page?: number; pageSize?: number }
interface IdParams { id: string }

const tags = ['admin-prompt-templates'];
const idSchema = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', format: 'uuid' } } };
const bodySchema = { type: 'string', minLength: 1, maxLength: 30000 };
const purposeSchema = { type: 'string', enum: [...PROMPT_PURPOSES] };
const uuidSchema = { type: 'string', format: 'uuid' };

export async function registerAdminPromptTemplateRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  const errorHandler: RouteOptions['errorHandler'] = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const issues = (error as Error & { issues?: PromptIssue[] }).issues;
    if (issues) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', reason: 'INVALID_PROMPT_TEMPLATE',
      message: '提示词模板校验失败', issues, requestId: request.id } });
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    request.log[status >= 500 ? 'error' : 'warn']({ code: error.code ?? 'REQUEST_ERROR', statusCode: status }, 'request failed');
    const reason = (error as FastifyError & { reason?: string }).reason;
    return reply.code(status).send({ error: { code: error.validation ? 'VALIDATION_ERROR' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
      ...(reason && status < 500 ? { reason } : {}), message: status >= 500 ? 'Internal server error' : 'Invalid request', requestId: request.id } });
  };
  app.get('/prompt-templates/definitions', { schema: { tags } }, async () => ({ code: 0, data: promptDefinitions() }));
  app.post<{ Body: PreviewInput }>('/prompt-templates/preview', {
    schema: { tags, body: { type: 'object', additionalProperties: false, required: ['purpose', 'body'], properties: {
      purpose: purposeSchema, body: { type: 'string', maxLength: 30000 }, sample: {
        type: 'object', additionalProperties: false, properties: {
          text: { type: 'string', maxLength: 1000 }, industryId: uuidSchema, styleId: uuidSchema,
          brandColors: { type: 'array', maxItems: 3, items: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
          brandKeywords: { type: 'string', maxLength: 200, pattern: '^[^\\u0000-\\u001f\\u007f]*$' },
        },
      },
    } } },
  }, async request => ({ code: 0, data: await previewPrompt(pool, request.body) }));
  app.get<{ Querystring: ListQuery }>('/prompt-templates', {
    schema: { tags, querystring: { type: 'object', additionalProperties: false, properties: {
      purpose: purposeSchema, enabled: { type: 'boolean' }, industryId: uuidSchema, styleId: uuidSchema,
      page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    } } },
  }, async request => ({ code: 0, data: await listPromptTemplates(pool, {
    ...request.query, page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 20,
  }) }));

  app.post<{ Body: CreateTemplateInput }>('/prompt-templates', {
    errorHandler,
    schema: { tags, body: { type: 'object', additionalProperties: false, required: ['purpose', 'body'], properties: {
      purpose: purposeSchema,
      industryId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
      styleId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
      body: bodySchema,
    } } },
  }, async request => ({ code: 0, data: await createPromptTemplate(pool, request.body, adminUserId(request)) }));

  app.get<{ Params: IdParams }>('/prompt-templates/:id', { schema: { tags, params: idSchema } }, async (request, reply) => {
    const template = await getPromptTemplate(pool, request.params.id);
    if (!template) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Prompt template not found', requestId: request.id } });
    return { code: 0, data: template };
  });

  app.patch<{ Params: IdParams; Body: UpdateTemplateInput }>('/prompt-templates/:id', {
    errorHandler,
    schema: { tags, params: idSchema, body: { type: 'object', additionalProperties: false, required: ['expectedRevision'], properties: {
      body: bodySchema, enabled: { type: 'boolean' },
      expectedRevision: { type: 'integer', minimum: 1 },
    } } },
  }, async request => ({ code: 0, data: await updatePromptTemplate(pool, request.params.id, request.body,
    adminUserId(request)) }));
}
