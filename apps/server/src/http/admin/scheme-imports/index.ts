import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import { readUploadedFile, workbookUploadMaxBytes } from '../../uploads.js';
import { commitImport } from '../../../modules/schemes/imports/commit.js';
import { previewImport } from '../../../modules/schemes/imports/preview.js';
import { buildImportTemplate } from '../../../modules/schemes/imports/template.js';
import type { CommitImportOptions } from '../../../modules/schemes/imports/types.js';
import { domainError } from '../../../lib/errors.js';

interface ImportParams {
  importId: string;
}

export async function registerAdminSchemeImportsRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  app.get('/scheme-imports/template', { config: { permissions: ['schemes.import'] },
    schema: { tags: ['admin-scheme-imports'], summary: '下载与当前解析规则和启用字典一致的方案导入模板' },
  }, async (_request, reply) => {
    const file = await buildImportTemplate(pool);
    return reply.header('Cache-Control', 'private, no-store')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('方案导入模板.xlsx')}`)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(file);
  });

  app.post('/scheme-imports', { config: { permissions: ['schemes.import'] },
    schema: { tags: ['admin-scheme-imports'] },
  }, async request => {
    const data = await request.file({ limits: { fileSize: workbookUploadMaxBytes } });
    if (!data) throw domainError('FILE_REQUIRED', 400);
    const lowerFilename = data.filename.toLowerCase();
    if (!lowerFilename.endsWith('.xlsx')) throw domainError('UNSUPPORTED_FILE_TYPE', 400);
    const buffer = await readUploadedFile(data);
    const adminId = adminUserId(request);
    const result = await previewImport(pool, adminId, buffer, data.filename);
    return { code: 0, data: result };
  });

  app.post('/scheme-imports/:importId/commit', { config: { permissions: ['schemes.import'] },
    schema: {
      tags: ['admin-scheme-imports'],
      params: { type: 'object', required: ['importId'], additionalProperties: false, properties: { importId: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object', required: ['duplicateStrategy'], additionalProperties: false,
        properties: {
          duplicateStrategy: { type: 'string', enum: ['skip', 'update'] },
          selectedRowIds: { type: 'array', items: { type: 'integer', minimum: 1 }, uniqueItems: true },
        },
      },
    },
  }, async request => {
    const adminId = adminUserId(request);
    const params = request.params as ImportParams;
    return { code: 0, data: await commitImport(pool, adminId, params.importId, request.body as CommitImportOptions) };
  });
}
