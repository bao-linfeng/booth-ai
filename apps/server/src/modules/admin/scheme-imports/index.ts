import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { importSchemesFromBuffer } from './service.js';

export async function registerAdminSchemeImportsRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.post('/scheme-imports', {
    schema: { tags: ['admin-scheme-imports'] },
  }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' } });
    }
    if (!data.filename.endsWith('.xlsx') && !data.filename.endsWith('.xls')) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Only Excel files (.xlsx/.xls) are supported' } });
    }
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const adminId: string | null = null;
    const result = await importSchemesFromBuffer(pool, adminId, buffer);
    return { code: 0, data: result };
  });
}
