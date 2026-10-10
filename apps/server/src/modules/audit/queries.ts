import type pg from 'pg';

// 审计日志由各业务写入方在事务内记录（infra/audit.ts 等），这里只提供管理端查询。
export interface AuditLogRecord {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogQuery {
  page?: number;
  pageSize?: number;
  adminId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
}

const columns = `id::text AS id, admin_id::text AS "adminId", action, target_type AS "targetType", target_id AS "targetId", detail, created_at AS "createdAt"`;

export async function listAuditLogs(pool: Pick<pg.Pool, 'query'>, query: AuditLogQuery) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const conditions: string[] = [];
  const values: unknown[] = [];
  const add = (condition: string, value: unknown) => {
    values.push(value);
    conditions.push(condition.replace('?', `$${values.length}`));
  };
  if (query.adminId) add('admin_id = ?::uuid', query.adminId);
  if (query.targetType) add('target_type = ?', query.targetType);
  if (query.targetId) add('target_id = ?', query.targetId);
  if (query.action) add('action = ?', query.action);
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;
  const [rows, count] = await Promise.all([
    pool.query<Omit<AuditLogRecord, 'createdAt'> & { createdAt: Date | string }>(
      `SELECT ${columns} FROM admin_audit_logs${where} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    ),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM admin_audit_logs${where}`, values),
  ]);
  const data: AuditLogRecord[] = rows.rows.map(row => ({
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }));
  return { data, total: Number(count.rows[0]?.total ?? 0), page, pageSize };
}
