import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Config } from '../../../config.js';
import { createHash } from 'node:crypto';
import type { createStorage } from '../../../infra/storage.js';
import { requirementSchema, validateRequirement, type Requirement } from './domain.js';
import { loadCandidatePool, loadCatalog } from './repository.js';
import { matchSchemes } from './match.js';
import { parseRequirement } from './parse.js';
import { activeAiModels, type ActiveAiModel } from '../../../infra/ai-models.js';
import { parseWithModels } from './llm.js';
import { getActivePromptTemplate } from '../../prompts/service.js';
import { PROMPT_DEFAULT_VERSION } from '../../prompts/template.js';
import { buildSelectionMessages } from './prompt.js';
import { deliverableAvailability } from '../schemes/service.js';
import { ensureAttempt, getOptionalClientUserId, getVisitorId, recordParse, recordSearch } from '../../selection-analytics/service.js';

export async function registerSelectionRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis, storage: ReturnType<typeof createStorage>, config: Config) {
  const dependency = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      throw Object.assign(new Error('Selection dependency unavailable'), { statusCode: 503 });
    }
  };
  
  await app.register(async selection => {
    selection.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const key = `selection:rate:${createHash('sha256').update(request.ip).digest('hex')}:${Math.floor(Date.now() / 60000)}`;
      const count = await dependency(() => redis.eval('local n = redis.call("INCR", KEYS[1]); if n == 1 then redis.call("EXPIRE", KEYS[1], 60) end; return n', 1, key));
      if (Number(count) > 60) {
        reply.header('Retry-After', '60');
        throw Object.assign(new Error('Rate limited'), { statusCode: 429 });
      }
    });
    
    selection.get('/catalog/options', {
      schema: { tags: ['AI 智选'], summary: '获取智选公共条件' }
    }, async () => {
      return { code: 0, data: await dependency(() => loadCatalog(pool)) };
    });
    
    selection.post<{ Body: { attemptId?: string; text: string; form: Requirement } }>('/requirements/parse', {
      schema: {
        tags: ['AI 智选'],
        summary: '模型解析需求，失败时规则降级',
        body: {
          type: 'object',
          additionalProperties: false,
           required: ['text', 'form'],
           properties: {
             attemptId: { type: 'string', format: 'uuid' },
            text: { type: 'string', minLength: 1, maxLength: 1000, pattern: '\\S' },
            form: requirementSchema
          }
        }
      }
    }, async request => {
      const startedAt = performance.now();
      const visitorId = getVisitorId(request);
      const userId = await getOptionalClientUserId(pool, redis, request);
      const attemptId = await ensureAttempt(pool, request.body.attemptId, { visitorId, userId });
      const catalog = await dependency(() => loadCatalog(pool));
      const form = validateRequirement(request.body.form, catalog);
      const models: ActiveAiModel[] = await dependency(() => activeAiModels(pool, 'selection_parse', config.aiModelEncryptionKey));
      const template = models.length ? await dependency(() => getActivePromptTemplate(pool, 'filter')) : null;
      const promptSnapshot = models.length ? {
        source: template ? 'template' : 'default', templateId: template?.id ?? null, revision: template?.revision ?? null,
        defaultVersion: PROMPT_DEFAULT_VERSION, messages: buildSelectionMessages(request.body.text, catalog, template?.body),
      } : null;
      const parsed = models.length ? await parseWithModels(request.body.text, form, catalog, models, undefined, template?.body) : parseRequirement(request.body.text, form, catalog);
      const data = {
        ...parsed,
        parser: parsed.parser as 'llm' | 'rules' | 'none',
        dictionaryVersion: catalog.dictionaryVersion,
      };
      const parseId = await recordParse(pool, {
        attemptId, identity: { visitorId, userId }, inputText: request.body.text, formRequirement: form,
        result: data, promptSnapshot, durationMs: performance.now() - startedAt,
      });
      request.log.info({ attemptId, parseId, degraded: data.degraded }, 'selection parse recorded');
      return { code: 0, data: { ...data, attemptId, parseId, visitorId } };
    });

    selection.post<{ Body: { attemptId?: string; parseId?: string; mode: 'random' | 'filtered'; inputContext: { textProvided: boolean; text?: string; degradedParse?: boolean }; requirement: Requirement } }>('/scheme-matches', {
      schema: {
        tags: ['AI 智选'],
        summary: '匹配已审核公开方案',
        body: {
          type: 'object',
          additionalProperties: false,
           required: ['mode', 'inputContext', 'requirement'],
           properties: {
             attemptId: { type: 'string', format: 'uuid' },
             parseId: { type: 'string', format: 'uuid' },
            mode: { type: 'string', enum: ['random', 'filtered'] },
            requirement: requirementSchema,
            inputContext: {
              type: 'object',
              additionalProperties: false,
              required: ['textProvided'],
              properties: { textProvided: { type: 'boolean' }, text: { type: 'string', maxLength: 1000 }, degradedParse: { type: 'boolean' } }
            }
          }
        }
      }
    }, async request => {
      const startedAt = performance.now();
      const visitorId = getVisitorId(request);
      const userId = await getOptionalClientUserId(pool, redis, request);
      const attemptId = await ensureAttempt(pool, request.body.attemptId, { visitorId, userId });
      const catalog = await dependency(() => loadCatalog(pool));
      const requirement = validateRequirement(request.body.requirement, catalog);
       const { candidates, diagnostics } = await dependency(() => loadCandidatePool(pool, catalog, storage));
       const result = matchSchemes(candidates, requirement, request.body.mode, request.body.inputContext.textProvided, diagnostics, catalog.applicabilityQuestions);
      const data = {
        ...result,
        status: result.status as 'matched' | 'no_match' | 'needs_clarification',
        dictionaryVersion: catalog.dictionaryVersion,
        attemptId,
        visitorId,
      };
      
      request.log.info({
        rulesVersion: result.rulesVersion,
        candidateCount: candidates.length,
         counts: result.counts,
         diagnostics: result.diagnostics
      }, 'selection completed');
      
      const searchId = await recordSearch(pool, {
        attemptId, parseId: request.body.parseId ?? null, identity: { visitorId, userId }, mode: request.body.mode,
        inputText: request.body.inputContext.text ?? '', result: data, degradedParse: request.body.inputContext.degradedParse ?? false,
        durationMs: performance.now() - startedAt,
      });
      request.log.info({ attemptId, searchId }, 'selection search recorded');
      return { code: 0, data: { ...data, searchId } };
    });
    
    selection.get<{ Params: { code: string } }>('/schemes/:code', {
      schema: {
        tags: ['AI 智选'],
        summary: '读取最新公开方案详情',
        params: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 1, maxLength: 200 } }
        }
      }
    }, async request => {
      const catalog = await dependency(() => loadCatalog(pool));
       const { candidates: [candidate] } = await dependency(() => loadCandidatePool(pool, catalog, storage, request.params.code));
      
      if (!candidate) throw Object.assign(new Error('Scheme not visible'), { statusCode: 404 });
      const availability = await dependency(() => deliverableAvailability(pool, candidate.code));
      
      return {
        code: 0,
        data: {
          code: candidate.code,
          images: candidate.images,
          specifications: candidate.specifications,
          applicabilityNotes: candidate.applicabilityNotes,
          resources: { model: availability.model, bom: true, renderings: candidate.images.length > 0, masks: candidate.images.length === 3, drawings: availability.drawing, artworks: availability.artwork },
          actions: {
            theme: 'available',
            bom: 'available',
            drawings: availability.drawing ? 'available' : 'unavailable',
            artworks: availability.artwork ? 'available' : 'unavailable',
            quote: 'available',
            modelDownload: availability.model ? 'available' : 'unavailable'
          },
        }
      };
    });
  });
}
