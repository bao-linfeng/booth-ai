import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

interface AuditLogRow {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  createdAt: Date | string;
}

interface AuditLogRecord {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

interface ListQuery {
  page?: number;
  pageSize?: number;
  adminId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
}

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

const columns = `id::text AS id, admin_id::text AS "adminId", action, target_type AS "targetType", target_id AS "targetId", detail, created_at AS "createdAt"`;

function toRecord(row: AuditLogRow): AuditLogRecord {
  return { ...row, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt };
}

export async function registerAdminAuditLogsRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get('/audit-logs', { schema: { tags: ['admin-audit-logs'], querystring: listQuerySchema } }, async request => {
    const query = request.query as ListQuery;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (condition: string, value: unknown) => { values.push(value); conditions.push(condition.replace('?', `$${values.length}`)); };
    if (query.adminId)    add('admin_id = ?::uuid', query.adminId);
    if (query.targetType) add('target_type = ?', query.targetType);
    if (query.targetId)   add('target_id = ?', query.targetId);
    if (query.action)     add('action = ?', query.action);
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;
    const [rows, count] = await Promise.all([
      pool.query<AuditLogRow>(`SELECT ${columns} FROM admin_audit_logs${where} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, offset]),
      pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM admin_audit_logs${where}`, values),
    ]);
    return { code: 0, data: { data: rows.rows.map(toRecord), total: Number(count.rows[0]?.total ?? 0), page, pageSize } };
  });
}
