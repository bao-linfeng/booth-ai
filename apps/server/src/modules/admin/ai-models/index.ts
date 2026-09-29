import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { listAiModels, modelDefinitions, type AiProvider } from '../../../infra/ai-models.js';
import { getAdminIdFromRequest } from '../session.js';
import { updateAiModel, type ModelUpdate } from './service.js';

export async function registerAdminAiModelRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis, encryptionKey: string) {
  app.get('/ai-models', { schema: { tags: ['AI 模型配置'] } }, async () => ({ code: 0, data: await listAiModels(pool) }));

  app.put<{ Params: { provider: AiProvider }; Body: ModelUpdate }>('/ai-models/:provider', {
    schema: {
      tags: ['AI 模型配置'],
      params: { type: 'object', required: ['provider'], properties: { provider: { type: 'string', enum: Object.keys(modelDefinitions) } } },
      body: { type: 'object', additionalProperties: false, required: ['enabled', 'priority', 'unitCredits', 'expectedRevision'], properties: {
        enabled: { type: 'boolean' }, priority: { type: 'integer', minimum: 0, maximum: 2 },
        unitCredits: { anyOf: [{ type: 'integer', minimum: 1, maximum: 100000 }, { type: 'null' }] },
        expectedRevision: { type: 'integer', minimum: 1 },
        apiKey: { anyOf: [{ type: 'string', minLength: 1, maxLength: 2048 }, { type: 'null' }] },
      } }
    }
  }, async request => ({ code: 0, data: await updateAiModel(pool, request.params.provider, request.body,
    await getAdminIdFromRequest(request, redis), encryptionKey) }));
}
