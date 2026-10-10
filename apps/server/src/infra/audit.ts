import type pg from 'pg';

export interface AuditEntry {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail?: Record<string, unknown>;
}

export async function writeAuditLog(client: pg.Pool | pg.PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [entry.adminId, entry.action, entry.targetType, entry.targetId, JSON.stringify(entry.detail ?? {})],
  );
}
