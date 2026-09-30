import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getGenerationJob, listGenerationJobs, type GenerationJobQuery } from './service.js';

export async function registerAdminGenerationJobRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  storage: { signDownload: (key: string, expiresIn: number) => Promise<string> },
): Promise<void> {
  app.get('/generation-jobs', { schema: { tags: ['admin-generation-jobs'], querystring: {
    type: 'object', additionalProperties: false, properties: {
      page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      jobType: { type: 'string', enum: ['theme', 'artwork'] },
      status: { type: 'string', enum: ['pending', 'queued', 'running', 'settling', 'succeeded', 'partially_succeeded', 'failed'] },
      userId: { type: 'string', format: 'uuid' }, schemeCode: { type: 'string' },
      from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' },
    },
  } } }, async request => ({ code: 0, data: await listGenerationJobs(pool, request.query as GenerationJobQuery) }));

  app.get('/generation-jobs/:jobId', { schema: { tags: ['admin-generation-jobs'], params: {
    type: 'object', required: ['jobId'], additionalProperties: false, properties: { jobId: { type: 'string', format: 'uuid' } },
  } } }, async request => ({ code: 0, data: await getGenerationJob(pool, (request.params as { jobId: string }).jobId, storage) }));
}
