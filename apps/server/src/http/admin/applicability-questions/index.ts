import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createQuestion, deleteQuestion, getQuestion, listQuestions, updateQuestion, type CreateQuestionInput, type UpdateQuestionInput } from '../../../modules/selection/applicability-questions.js';

interface ListQuery { enabled?: boolean; page?: number; pageSize?: number }
interface IdParams { id: string }

const tags = ['admin-applicability-questions'];
const idParamsSchema = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', minLength: 1, maxLength: 100 } } };

export async function registerAdminApplicabilityQuestionRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get<{ Querystring: ListQuery }>('/applicability-questions', {
    schema: { tags, querystring: { type: 'object', additionalProperties: false, properties: {
      enabled: { type: 'boolean' },
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    } } },
  }, async request => ({ code: 0, data: await listQuestions(pool, {
    ...request.query, page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 50,
  }) }));

  app.post<{ Body: CreateQuestionInput }>('/applicability-questions', {
    schema: { tags, body: { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: {
      id: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' },
      label: { type: 'string', minLength: 1, maxLength: 200 },
      helpText: { type: 'string', maxLength: 1000 },
      sortOrder: { type: 'integer', minimum: 0, maximum: 9999 },
    } } },
  }, async request => ({ code: 0, data: await createQuestion(pool, request.body) }));

  app.get<{ Params: IdParams }>('/applicability-questions/:id', { schema: { tags, params: idParamsSchema } }, async (request, reply) => {
    const question = await getQuestion(pool, request.params.id);
    if (!question) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Question not found', requestId: request.id } });
    return { code: 0, data: question };
  });

  app.patch<{ Params: IdParams; Body: UpdateQuestionInput }>('/applicability-questions/:id', {
    schema: { tags, params: idParamsSchema, body: { type: 'object', additionalProperties: false, properties: {
      label: { type: 'string', minLength: 1, maxLength: 200 },
      helpText: { type: 'string', maxLength: 1000 },
      sortOrder: { type: 'integer', minimum: 0, maximum: 9999 },
      enabled: { type: 'boolean' },
    } } },
  }, async request => ({ code: 0, data: await updateQuestion(pool, request.params.id, request.body) }));

  app.delete<{ Params: IdParams }>('/applicability-questions/:id', { schema: { tags, params: idParamsSchema } }, async (request, reply) => {
    await deleteQuestion(pool, request.params.id);
    return reply.code(204).send();
  });
}
