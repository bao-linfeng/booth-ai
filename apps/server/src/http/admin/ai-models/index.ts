import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { adminUserId } from '../../authentication.js';
import {
  AI_PURPOSES, createModel, createProvider, deleteModel, deleteProvider, listAssignments, listProtocols,
  listProviders, probeProviderModels, refreshProviderCatalog, replaceAssignments, updateModel, updateProvider,
  type AssignmentItem, type ModelInput, type ModelUpdate, type ProviderInput, type ProviderUpdate,
} from '../../../modules/ai-models/service.js';
import type { AiPurpose } from '../../../infra/ai/types.js';

const tags = ['AI 模型配置'];
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } as const;
const name = { type: 'string', minLength: 1, maxLength: 60 } as const;
const baseUrl = { anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] } as const;
const apiKey = { anyOf: [{ type: 'string', minLength: 1, maxLength: 2048 }, { type: 'null' }] } as const;
const modelId = { type: 'string', minLength: 1, maxLength: 200 } as const;
const params = { type: 'object', maxProperties: 20, additionalProperties: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'number' }] } } as const;
const revision = { type: 'integer', minimum: 1 } as const;

export async function registerAdminAiModelRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis, encryptionKey: string) {
  app.get('/ai-protocols', { schema: { tags, summary: '可接入的协议、模型类型与参数表单定义' } }, async () => ({ code: 0, data: listProtocols() }));

  app.get('/ai-providers', { schema: { tags, summary: '供应商及其模型（不返回密钥）' } }, async () => ({ code: 0, data: await listProviders(pool) }));

  app.post<{ Body: ProviderInput }>('/ai-providers', { schema: { tags, body: { type: 'object', additionalProperties: false,
    required: ['name', 'protocol', 'enabled'], properties: { name, protocol: { type: 'string', maxLength: 32 }, baseUrl, apiKey, enabled: { type: 'boolean' } } } } },
  async request => ({ code: 0, data: { id: await createProvider(pool, request.body, adminUserId(request), encryptionKey) } }));

  app.put<{ Params: { id: string }; Body: ProviderUpdate }>('/ai-providers/:id', { schema: { tags, params: idParams, body: { type: 'object',
    additionalProperties: false, required: ['name', 'enabled', 'expectedRevision'],
    properties: { name, baseUrl, apiKey, enabled: { type: 'boolean' }, expectedRevision: revision } } } },
  async request => {
    await updateProvider(pool, request.params.id, request.body, adminUserId(request), encryptionKey);
    return { code: 0, data: null };
  });

  app.delete<{ Params: { id: string } }>('/ai-providers/:id', { schema: { tags, params: idParams } }, async request => {
    await deleteProvider(pool, request.params.id, adminUserId(request));
    return { code: 0, data: null };
  });

  app.post<{ Params: { id: string } }>('/ai-providers/:id/catalog/refresh', { schema: { tags,
    summary: '用已保存的地址和密钥实时拉取供应商模型列表，并保存为该供应商的模型目录', params: idParams } },
  async request => ({ code: 0, data: await refreshProviderCatalog(pool, request.params.id, adminUserId(request), encryptionKey) }));

  app.post<{ Body: { protocol: string; baseUrl?: string | null; apiKey: string } }>('/ai-providers/probe', { schema: { tags,
    summary: '用未保存的表单值测试连接并拉取模型列表', body: { type: 'object', additionalProperties: false, required: ['protocol', 'apiKey'],
      properties: { protocol: { type: 'string', maxLength: 32 }, baseUrl, apiKey: { type: 'string', minLength: 1, maxLength: 2048 } } } } },
  async request => ({ code: 0, data: await probeProviderModels(request.body) }));

  app.post<{ Body: ModelInput }>('/ai-models', { schema: { tags, body: { type: 'object', additionalProperties: false,
    required: ['providerId', 'kind', 'model', 'params', 'enabled'], properties: { providerId: { type: 'string', format: 'uuid' },
      kind: { type: 'string', enum: ['text', 'image'] }, model: modelId, params, enabled: { type: 'boolean' } } } } },
  async request => ({ code: 0, data: { id: await createModel(pool, request.body, adminUserId(request)) } }));

  app.put<{ Params: { id: string }; Body: ModelUpdate }>('/ai-models/:id', { schema: { tags, params: idParams, body: { type: 'object',
    additionalProperties: false, required: ['model', 'params', 'enabled', 'expectedRevision'],
    properties: { model: modelId, params, enabled: { type: 'boolean' }, expectedRevision: revision } } } },
  async request => {
    await updateModel(pool, request.params.id, request.body, adminUserId(request));
    return { code: 0, data: null };
  });

  app.delete<{ Params: { id: string } }>('/ai-models/:id', { schema: { tags, params: idParams } }, async request => {
    await deleteModel(pool, request.params.id, adminUserId(request));
    return { code: 0, data: null };
  });

  app.get('/ai-model-assignments', { schema: { tags, summary: '各用途使用的模型、主备顺序与积分' } }, async () => ({ code: 0, data: await listAssignments(pool) }));

  app.put<{ Params: { purpose: AiPurpose }; Body: { expectedVersion: string; items: AssignmentItem[] } }>('/ai-model-assignments/:purpose', {
    schema: { tags, params: { type: 'object', required: ['purpose'], properties: { purpose: { type: 'string', enum: AI_PURPOSES } } },
      body: { type: 'object', additionalProperties: false, required: ['expectedVersion', 'items'], properties: {
        expectedVersion: { type: 'string', maxLength: 64 },
        items: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['modelId', 'unitCredits'], properties: {
          modelId: { type: 'string', format: 'uuid' }, unitCredits: { anyOf: [{ type: 'integer', minimum: 1, maximum: 100000 }, { type: 'null' }] } } } },
      } } },
  }, async request => ({ code: 0, data: await replaceAssignments(pool, request.params.purpose, request.body, adminUserId(request)) }));
}
