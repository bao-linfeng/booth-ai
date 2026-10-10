import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { listAuditLogs, type AuditLogQuery } from '../../../modules/audit/queries.js';

const listQuerySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    page:       { type: 'integer', minimum: 1 },
    pageSize:   { type: 'integer', minimum: 1, maximum: 100 },
    adminId:    { type: 'string', format: 'uuid' },
    targetType: { type: 'string', minLength: 1 },
    targetId:   { type: 'string', minLength: 1 },
    action:     { type: 'string', minLength: 1 },
  },
};

export async function registerAdminAuditLogsRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get<{ Querystring: AuditLogQuery }>('/audit-logs', { config: { permissions: ['audit.read'] }, schema: { tags: ['admin-audit-logs'], querystring: listQuerySchema } },
    async request => ({ code: 0, data: await listAuditLogs(pool, request.query) }));
}
