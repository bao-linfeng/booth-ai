import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import { createPromptTemplate, getPromptTemplate, listPromptTemplates, updatePromptTemplate,
  type CreateTemplateInput, type UpdateTemplateInput } from '../../../modules/prompts/management-service.js';
import { promptDefinitions, previewPrompt, type PreviewInput } from '../../../modules/prompt-preview/service.js';
import { PROMPT_PURPOSES } from '../../../modules/prompts/template.js';
import { domainError } from '../../../lib/errors.js';
import { requireAdminPermission } from '../authorization.js';

interface ListQuery { purpose?: string; industryId?: string; styleId?: string; enabled?: boolean; page?: number; pageSize?: number }
interface IdParams { id: string }

const tags = ['admin-prompt-templates'];
const idSchema = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', format: 'uuid' } } };
const bodySchema = { type: 'string', minLength: 1, maxLength: 30000 };
const purposeSchema = { type: 'string', enum: [...PROMPT_PURPOSES] };
const uuidSchema = { type: 'string', format: 'uuid' };

export async function registerAdminPromptTemplateRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get('/prompt-templates/definitions', { config: { permissions: ['prompts.read'] }, schema: { tags } }, async () => ({ code: 0, data: promptDefinitions() }));
  app.post<{ Body: PreviewInput }>('/prompt-templates/preview', { config: { permissions: ['prompts.preview'] },
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
  app.get<{ Querystring: ListQuery }>('/prompt-templates', { config: { permissions: ['prompts.read'] },
    schema: { tags, querystring: { type: 'object', additionalProperties: false, properties: {
      purpose: purposeSchema, enabled: { type: 'boolean' }, industryId: uuidSchema, styleId: uuidSchema,
      page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    } } },
  }, async request => ({ code: 0, data: await listPromptTemplates(pool, {
    ...request.query, page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 20,
  }) }));

  app.post<{ Body: CreateTemplateInput }>('/prompt-templates', { config: { permissions: ['prompts.create'] },
    schema: { tags, body: { type: 'object', additionalProperties: false, required: ['purpose', 'body'], properties: {
      purpose: purposeSchema,
      industryId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
      styleId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
      body: bodySchema,
    } } },
  }, async request => ({ code: 0, data: await createPromptTemplate(pool, request.body, adminUserId(request)) }));

  app.get<{ Params: IdParams }>('/prompt-templates/:id', { config: { permissions: ['prompts.read'] }, schema: { tags, params: idSchema } }, async request => {
    const template = await getPromptTemplate(pool, request.params.id);
    if (!template) throw domainError('RESOURCE_NOT_FOUND', 404);
    return { code: 0, data: template };
  });

  app.patch<{ Params: IdParams; Body: UpdateTemplateInput }>('/prompt-templates/:id', { config: { permissions: ['prompts.update', 'prompts.enable', 'prompts.disable'] },
    schema: { tags, params: idSchema, body: { type: 'object', additionalProperties: false, required: ['expectedRevision'], properties: {
      body: bodySchema, enabled: { type: 'boolean' },
      expectedRevision: { type: 'integer', minimum: 1 },
    } } },
    // 字段级权限：修改正文需要 update，启用 / 停用分别需要 enable / disable
    preHandler: async request => {
      const body = request.body;
      if (Object.keys(body).some(key => key !== 'enabled' && key !== 'expectedRevision')) requireAdminPermission(request, 'prompts.update');
      if (body.enabled !== undefined) requireAdminPermission(request, body.enabled ? 'prompts.enable' : 'prompts.disable');
    },
  }, async request => ({ code: 0, data: await updatePromptTemplate(pool, request.params.id, request.body,
    adminUserId(request)) }));
}
