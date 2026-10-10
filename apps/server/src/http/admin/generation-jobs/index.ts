import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getGenerationJob, listGenerationJobs, type GenerationJobQuery } from '../../../modules/generation/queries.js';
import { writeAuditLog } from '../../../infra/audit.js';
import { adminUserId } from '../../authentication.js';
import type { Redis } from 'ioredis';

export async function registerAdminGenerationJobRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  storage: { signDownload: (key: string, expiresIn: number) => Promise<string> },
  redis?: Redis,
): Promise<void> {
  app.get(
    '/generation-jobs',
    {
      config: { permissions: ['generation.read'] },
      schema: {
        tags: ['admin-generation-jobs'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
            jobType: { type: 'string', enum: ['theme', 'artwork'] },
            status: { type: 'string', enum: ['pending', 'queued', 'running', 'settling', 'succeeded', 'partially_succeeded', 'failed'] },
            userId: { type: 'string', format: 'uuid' },
            schemeCode: { type: 'string' },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            creditIssue: { type: 'boolean' },
          },
        },
      },
    },
    async request => ({ code: 0, data: await listGenerationJobs(pool, request.query as GenerationJobQuery) }),
  );

  app.get(
    '/generation-jobs/:jobId',
    {
      config: { permissions: ['generation.detail'] },
      schema: {
        tags: ['admin-generation-jobs'],
        params: {
          type: 'object',
          required: ['jobId'],
          additionalProperties: false,
          properties: { jobId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const jobId = (request.params as { jobId: string }).jobId;
      if (redis)
        await writeAuditLog(pool, {
          adminId: adminUserId(request),
          action: 'generation_job.view',
          targetType: 'generation_job',
          targetId: jobId,
        });
      return { code: 0, data: await getGenerationJob(pool, jobId, storage) };
    },
  );
}
