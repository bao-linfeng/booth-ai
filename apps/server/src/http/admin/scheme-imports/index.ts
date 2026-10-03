import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import { commitImport } from '../../../modules/schemes/imports/commit.js';
import { previewImport } from '../../../modules/schemes/imports/preview.js';
import type { CommitImportOptions } from '../../../modules/schemes/imports/types.js';

interface ImportParams {
  importId: string;
}

export async function registerAdminSchemeImportsRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  app.post('/scheme-imports', {
    schema: { tags: ['admin-scheme-imports'] },
  }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' } });
    }
    const lowerFilename = data.filename.toLowerCase();
    if (!lowerFilename.endsWith('.xlsx')) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Only .xlsx files are supported' } });
    }
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const adminId = adminUserId(request);
    const result = await previewImport(pool, adminId, buffer, data.filename);
    return { code: 0, data: result };
  });

  app.post('/scheme-imports/:importId/commit', {
    schema: {
      tags: ['admin-scheme-imports'],
      params: { type: 'object', required: ['importId'], additionalProperties: false, properties: { importId: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object', required: ['duplicateStrategy'], additionalProperties: false,
        properties: {
          duplicateStrategy: { type: 'string', enum: ['skip', 'update'] },
          selectedRows: { type: 'array', items: { type: 'integer', minimum: 2 }, uniqueItems: true },
        },
      },
    },
  }, async request => {
    const adminId = adminUserId(request);
    const params = request.params as ImportParams;
    return { code: 0, data: await commitImport(pool, adminId, params.importId, request.body as CommitImportOptions) };
  });
}
