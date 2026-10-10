import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { TypeProvider } from '../../type-provider.js';
import { adminUserId } from '../../authentication.js';
import {
  createPromptTemplate,
  getPromptTemplate,
  listPromptTemplates,
  updatePromptTemplate,
} from '../../../modules/prompts/management-service.js';
import { promptDefinitions, previewPrompt } from '../../../modules/prompt-preview/service.js';
import { PROMPT_PURPOSES } from '../../../modules/prompts/template.js';
import { domainError } from '../../../lib/errors.js';
import { successResponse } from '../../schemas.js';
import { requireAdminPermission } from '../authorization.js';

const tags = ['admin-prompt-templates'];
const idSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;
const bodySchema = { type: 'string', minLength: 1, maxLength: 30000 } as const;
const purposeSchema = { type: 'string', enum: PROMPT_PURPOSES } as const;
const uuidSchema = { type: 'string', format: 'uuid' } as const;
const string = { type: 'string' } as const;
const strings = { type: 'array', items: string } as const;
const nullableString = { type: ['string', 'null'] } as const;

const templateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'purpose', 'industryId', 'styleId', 'body', 'variables', 'enabled', 'revision', 'createdAt', 'updatedAt'],
  properties: {
    id: string,
    purpose: purposeSchema,
    industryId: nullableString,
    styleId: nullableString,
    body: string,
    variables: strings,
    enabled: { type: 'boolean' },
    revision: { type: 'integer' },
    createdAt: string,
    updatedAt: string,
  },
} as const;

const definitionsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['purpose', 'label', 'defaultBody', 'defaultVersion', 'fixedInstructions', 'variables', 'scope', 'inputs'],
    properties: {
      purpose: purposeSchema,
      label: string,
      defaultBody: string,
      defaultVersion: { type: 'integer' },
      fixedInstructions: string,
      variables: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'label', 'source', 'example', 'fallback'],
          properties: { name: string, label: string, source: string, example: string, fallback: string },
        },
      },
      scope: string,
      inputs: strings,
    },
  },
} as const;

const previewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['variables', 'issues', 'messages', 'directionPrompts', 'attachments'],
  properties: {
    variables: strings,
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message'],
        properties: { code: string, message: string, variable: string, offset: { type: 'integer' } },
      },
    },
    messages: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['role', 'content'], properties: { role: string, content: string } },
    },
    directionPrompts: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['front', 'back', 'left', 'right'],
          properties: { front: string, back: string, left: string, right: string },
        },
        { type: 'null' },
      ],
    },
    attachments: strings,
    dictionaryVersion: string,
  },
} as const;

export async function registerAdminPromptTemplateRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/prompt-templates/definitions',
    { config: { permissions: ['prompts.read'] }, schema: { tags, response: { 200: successResponse(definitionsSchema) } } },
    async () => ({ code: 0, data: promptDefinitions() }) as const,
  );
  routes.post(
    '/prompt-templates/preview',
    {
      config: { permissions: ['prompts.preview'] },
      schema: {
        tags,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['purpose', 'body'],
          properties: {
            purpose: purposeSchema,
            body: { type: 'string', maxLength: 30000 },
            sample: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string', maxLength: 1000 },
                industryId: uuidSchema,
                styleId: uuidSchema,
                brandColors: { type: 'array', maxItems: 3, items: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
                brandKeywords: { type: 'string', maxLength: 200, pattern: '^[^\\u0000-\\u001f\\u007f]*$' },
              },
            },
          },
        },
        response: { 200: successResponse(previewSchema) },
      },
    },
    async request => ({ code: 0, data: await previewPrompt(pool, request.body) }) as const,
  );
  routes.get(
    '/prompt-templates',
    {
      config: { permissions: ['prompts.read'] },
      schema: {
        tags,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            purpose: purposeSchema,
            enabled: { type: 'boolean' },
            industryId: uuidSchema,
            styleId: uuidSchema,
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
        response: {
          200: successResponse({
            type: 'object',
            additionalProperties: false,
            required: ['items', 'total'],
            properties: { items: { type: 'array', items: templateSchema }, total: { type: 'integer' } },
          }),
        },
      },
    },
    async request =>
      ({
        code: 0,
        data: await listPromptTemplates(pool, {
          ...request.query,
          page: request.query.page ?? 1,
          pageSize: request.query.pageSize ?? 20,
        }),
      }) as const,
  );

  routes.post(
    '/prompt-templates',
    {
      config: { permissions: ['prompts.create'] },
      schema: {
        tags,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['purpose', 'body'],
          properties: {
            purpose: purposeSchema,
            industryId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
            styleId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
            body: bodySchema,
          },
        },
        response: { 200: successResponse(templateSchema) },
      },
    },
    async request => ({ code: 0, data: await createPromptTemplate(pool, request.body, adminUserId(request)) }) as const,
  );

  routes.get(
    '/prompt-templates/:id',
    { config: { permissions: ['prompts.read'] }, schema: { tags, params: idSchema, response: { 200: successResponse(templateSchema) } } },
    async request => {
      const template = await getPromptTemplate(pool, request.params.id);
      if (!template) throw domainError('RESOURCE_NOT_FOUND', 404);
      return { code: 0, data: template } as const;
    },
  );

  routes.patch(
    '/prompt-templates/:id',
    {
      config: { permissions: ['prompts.update', 'prompts.enable', 'prompts.disable'] },
      schema: {
        tags,
        params: idSchema,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedRevision'],
          properties: {
            body: bodySchema,
            enabled: { type: 'boolean' },
            expectedRevision: { type: 'integer', minimum: 1 },
          },
        },
        response: { 200: successResponse(templateSchema) },
      },
      // 字段级权限：修改正文需要 update，启用 / 停用分别需要 enable / disable
      preHandler: async request => {
        const body = request.body;
        if (Object.keys(body).some(key => key !== 'enabled' && key !== 'expectedRevision'))
          requireAdminPermission(request, 'prompts.update');
        if (body.enabled !== undefined) requireAdminPermission(request, body.enabled ? 'prompts.enable' : 'prompts.disable');
      },
    },
    async request => ({ code: 0, data: await updatePromptTemplate(pool, request.params.id, request.body, adminUserId(request)) }) as const,
  );
}
