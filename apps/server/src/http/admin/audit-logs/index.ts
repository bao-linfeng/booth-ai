import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { listAuditLogs } from '../../../modules/audit/queries.js';
import { pageSchema, successResponse } from '../../schemas.js';

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    adminId: { type: 'string', format: 'uuid' },
    targetType: { type: 'string', minLength: 1 },
    targetId: { type: 'string', minLength: 1 },
    action: { type: 'string', minLength: 1 },
  },
} as const;

const auditLogSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'adminId', 'action', 'targetType', 'targetId', 'detail', 'createdAt'],
  properties: {
    id: { type: 'string' },
    adminId: { type: 'string' },
    action: { type: 'string' },
    targetType: { type: 'string' },
    targetId: { type: 'string' },
    detail: { type: 'object', additionalProperties: true, description: '操作前后的取值等审计明细，结构随 action 变化' },
    createdAt: { type: 'string' },
  },
} as const;

export async function registerAdminAuditLogsRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.withTypeProvider<TypeProvider>().get(
    '/audit-logs',
    {
      config: { permissions: ['audit.read'] },
      schema: { tags: ['admin-audit-logs'], querystring: listQuerySchema, response: { 200: successResponse(pageSchema(auditLogSchema)) } },
    },
    async request => ({ code: 0, data: await listAuditLogs(pool, request.query) }) as const,
  );
}
