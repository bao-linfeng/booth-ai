import type { FastifyInstance } from 'fastify';
import type { TypeProvider } from '../../type-provider.js';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { adminUserId } from '../../authentication.js';
import {
  AI_PURPOSES,
  createModel,
  createProvider,
  deleteModel,
  deleteProvider,
  listAssignments,
  listProtocols,
  listProviders,
  probeProviderModels,
  refreshProviderCatalog,
  replaceAssignments,
  updateModel,
  updateProvider,
} from '../../../modules/ai-models/service.js';
import { nullDataResponse, successResponse } from '../../schemas.js';

const tags = ['AI 模型配置'];
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } as const;
const name = { type: 'string', minLength: 1, maxLength: 60 } as const;
const baseUrl = { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] } as const;
const apiKey = { anyOf: [{ type: 'string', minLength: 1, maxLength: 2048 }, { type: 'null' }] } as const;
const modelId = { type: 'string', minLength: 1, maxLength: 200 } as const;
const params = {
  type: 'object',
  maxProperties: 20,
  additionalProperties: { type: ['string', 'number'], maxLength: 100 },
} as const;
const revision = { type: 'integer', minimum: 1 } as const;

const string = { type: 'string' } as const;
const purpose = { type: 'string', enum: ['selection_parse', 'theme', 'artwork', 'cs_translation'] } as const;
const modelKind = { type: 'string', enum: ['text', 'image'] } as const;
const discoveredModel = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: string, name: string, kind: modelKind },
} as const;
const discoveredModels = { type: 'array', items: discoveredModel } as const;
const paramField = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'label', 'type', 'default'],
  properties: {
    key: string,
    label: string,
    description: string,
    type: { type: 'string', enum: ['number', 'select'] },
    default: { type: ['number', 'string'] },
    min: { type: 'number' },
    max: { type: 'number' },
    step: { type: 'number' },
    options: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: string, value: string } },
    },
  },
} as const;
const protocolsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'description', 'defaultBaseUrl', 'discoverable', 'suggestedModels', 'kinds'],
    properties: {
      id: string,
      label: string,
      description: string,
      defaultBaseUrl: string,
      discoverable: { type: 'boolean' },
      suggestedModels: discoveredModels,
      kinds: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'params', 'purposes'],
          properties: { kind: modelKind, params: { type: 'array', items: paramField }, purposes: { type: 'array', items: purpose } },
        },
      },
    },
  },
} as const;
const modelParamsSchema = { type: 'object', additionalProperties: { type: ['string', 'number'] } } as const;
const providersSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'name',
      'protocol',
      'baseUrl',
      'credentialConfigured',
      'enabled',
      'revision',
      'modelCatalog',
      'catalogRefreshedAt',
      'models',
    ],
    properties: {
      id: string,
      name: string,
      protocol: string,
      baseUrl: string,
      credentialConfigured: { type: 'boolean', description: '是否已保存密钥；接口从不返回密钥本身' },
      enabled: { type: 'boolean' },
      revision: { type: 'integer' },
      modelCatalog: discoveredModels,
      catalogRefreshedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
      models: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'providerId', 'kind', 'model', 'params', 'enabled', 'revision', 'purposes'],
          properties: {
            id: string,
            providerId: string,
            kind: modelKind,
            model: string,
            params: modelParamsSchema,
            enabled: { type: 'boolean' },
            revision: { type: 'integer' },
            purposes: { type: 'array', items: purpose },
          },
        },
      },
    },
  },
} as const;
const assignmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose', 'version', 'items'],
  properties: {
    purpose,
    version: string,
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['modelId', 'unitCredits'],
        properties: { modelId: string, unitCredits: { type: ['integer', 'null'] } },
      },
    },
  },
} as const;
const createdIdResponse = {
  200: successResponse({ type: 'object', additionalProperties: false, required: ['id'], properties: { id: string } }),
} as const;

export async function registerAdminAiModelRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis, encryptionKey: string) {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/ai-protocols',
    {
      config: { permissions: ['ai-models.read'] },
      schema: { tags, summary: '可接入的协议、模型类型与参数表单定义', response: { 200: successResponse(protocolsSchema) } },
    },
    async () => ({ code: 0, data: listProtocols() }) as const,
  );

  routes.get(
    '/ai-providers',
    {
      config: { permissions: ['ai-models.read'] },
      schema: { tags, summary: '供应商及其模型（不返回密钥）', response: { 200: successResponse(providersSchema) } },
    },
    async () => ({ code: 0, data: await listProviders(pool) }) as const,
  );

  routes.post(
    '/ai-providers',
    {
      config: { permissions: ['ai-models.provider-create'] },
      schema: {
        tags,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'protocol', 'enabled'],
          properties: { name, protocol: { type: 'string', maxLength: 32 }, baseUrl, apiKey, enabled: { type: 'boolean' } },
        },
        response: createdIdResponse,
      },
    },
    async request => ({ code: 0, data: { id: await createProvider(pool, request.body, adminUserId(request), encryptionKey) } }) as const,
  );

  routes.put(
    '/ai-providers/:id',
    {
      config: { permissions: ['ai-models.provider-update'] },
      schema: {
        tags,
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'enabled', 'expectedRevision'],
          properties: { name, baseUrl, apiKey, enabled: { type: 'boolean' }, expectedRevision: revision },
        },
        response: { 200: nullDataResponse },
      },
    },
    async request => {
      await updateProvider(pool, request.params.id, request.body, adminUserId(request), encryptionKey);
      return { code: 0, data: null } as const;
    },
  );

  routes.delete(
    '/ai-providers/:id',
    { config: { permissions: ['ai-models.provider-delete'] }, schema: { tags, params: idParams, response: { 200: nullDataResponse } } },
    async request => {
      await deleteProvider(pool, request.params.id, adminUserId(request));
      return { code: 0, data: null } as const;
    },
  );

  routes.post(
    '/ai-providers/:id/catalog/refresh',
    {
      config: { permissions: ['ai-models.discover'] },
      schema: {
        tags,
        summary: '用已保存的地址和密钥实时拉取供应商模型列表，并保存为该供应商的模型目录',
        params: idParams,
        response: {
          200: successResponse({
            type: 'object',
            additionalProperties: false,
            required: ['models', 'refreshedAt'],
            properties: { models: discoveredModels, refreshedAt: { type: 'string', format: 'date-time' } },
          }),
        },
      },
    },
    async request =>
      ({ code: 0, data: await refreshProviderCatalog(pool, request.params.id, adminUserId(request), encryptionKey) }) as const,
  );

  routes.post(
    '/ai-providers/probe',
    {
      config: { permissions: ['ai-models.discover'] },
      schema: {
        tags,
        summary: '用未保存的表单值测试连接并拉取模型列表',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['protocol', 'apiKey'],
          properties: { protocol: { type: 'string', maxLength: 32 }, baseUrl, apiKey: { type: 'string', minLength: 1, maxLength: 2048 } },
        },
        response: { 200: successResponse(discoveredModels) },
      },
    },
    async request => ({ code: 0, data: await probeProviderModels(request.body) }) as const,
  );

  routes.post(
    '/ai-models',
    {
      config: { permissions: ['ai-models.model-create'] },
      schema: {
        tags,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['providerId', 'kind', 'model', 'params', 'enabled'],
          properties: {
            providerId: { type: 'string', format: 'uuid' },
            kind: { type: 'string', enum: ['text', 'image'] },
            model: modelId,
            params,
            enabled: { type: 'boolean' },
          },
        },
        response: createdIdResponse,
      },
    },
    async request => ({ code: 0, data: { id: await createModel(pool, request.body, adminUserId(request)) } }) as const,
  );

  routes.put(
    '/ai-models/:id',
    {
      config: { permissions: ['ai-models.model-update'] },
      schema: {
        tags,
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['model', 'params', 'enabled', 'expectedRevision'],
          properties: { model: modelId, params, enabled: { type: 'boolean' }, expectedRevision: revision },
        },
        response: { 200: nullDataResponse },
      },
    },
    async request => {
      await updateModel(pool, request.params.id, request.body, adminUserId(request));
      return { code: 0, data: null } as const;
    },
  );

  routes.delete(
    '/ai-models/:id',
    { config: { permissions: ['ai-models.model-delete'] }, schema: { tags, params: idParams, response: { 200: nullDataResponse } } },
    async request => {
      await deleteModel(pool, request.params.id, adminUserId(request));
      return { code: 0, data: null } as const;
    },
  );

  routes.get(
    '/ai-model-assignments',
    {
      config: { permissions: ['ai-models.read'] },
      schema: {
        tags,
        summary: '各用途使用的模型、主备顺序与积分',
        response: { 200: successResponse({ type: 'array', items: assignmentSchema }) },
      },
    },
    async () => ({ code: 0, data: await listAssignments(pool) }) as const,
  );

  routes.put(
    '/ai-model-assignments/:purpose',
    {
      config: { permissions: ['ai-models.assign'] },
      schema: {
        tags,
        params: { type: 'object', required: ['purpose'], properties: { purpose: { type: 'string', enum: AI_PURPOSES } } },
        response: { 200: successResponse(assignmentSchema) },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion', 'items'],
          properties: {
            expectedVersion: { type: 'string', maxLength: 64 },
            items: {
              type: 'array',
              maxItems: 10,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['modelId', 'unitCredits'],
                properties: {
                  modelId: { type: 'string', format: 'uuid' },
                  unitCredits: { anyOf: [{ type: 'integer', minimum: 1, maximum: 100000 }, { type: 'null' }] },
                },
              },
            },
          },
        },
      },
    },
    async request =>
      ({ code: 0, data: await replaceAssignments(pool, request.params.purpose, request.body, adminUserId(request)) }) as const,
  );
}
