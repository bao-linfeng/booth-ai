import type pg from 'pg';

export type AssigneeStatus = 'active' | 'disabled' | 'permission_revoked' | 'unassigned';
/** 新需求进入待分配池的原因 */
export type PoolReason = 'unconfigured' | 'disabled' | 'permission_revoked';
export interface AssignmentConfig {
  defaultAssigneeAdminId: string | null;
  assigneeName: string | null;
  status: Exclude<AssigneeStatus, 'unassigned'> | 'unconfigured';
  revision: number;
  updatedAt: string;
}

export function assigneePermissionSql(alias: string): string {
  return ['projects.read', 'projects.follow-up']
    .map(
      permission => `EXISTS (
    SELECT 1 FROM admin_roles r WHERE r.active AND r.name=ANY(${alias}.roles)
    AND '${permission}'=ANY(r.permission_codes))`,
    )
    .join(' AND ');
}

export function assigneeStatusSql(alias: string): string {
  return `CASE WHEN ${alias}.id IS NULL THEN 'unassigned' WHEN NOT ${alias}.enabled THEN 'disabled'
    WHEN ${assigneePermissionSql(alias)} THEN 'active' ELSE 'permission_revoked' END`;
}

export async function getAssignmentConfig(db: pg.Pool | pg.PoolClient): Promise<AssignmentConfig> {
  const row = (
    await db.query<AssignmentConfig>(`SELECT c.default_assignee_admin_id AS "defaultAssigneeAdminId",
    coalesce(a.nickname,a.username) AS "assigneeName",c.revision,c.updated_at AS "updatedAt",
    CASE WHEN c.default_assignee_admin_id IS NULL THEN 'unconfigured' ELSE ${assigneeStatusSql('a')} END AS status
    FROM project_assignment_config c LEFT JOIN admins a ON a.id=c.default_assignee_admin_id WHERE c.id=true`)
  ).rows[0];
  // 配置行由迁移 066 写入，缺失说明数据库被破坏
  if (!row) throw new Error('project_assignment_config row is missing');
  return row;
}

/** 管理员当前能否承接项目；对管理员与其角色加共享锁，保证判断到事务结束前有效 */
async function assigneeState(client: pg.PoolClient, id: string): Promise<'active' | PoolReason> {
  const admin = (await client.query<{ enabled: boolean; roles: string[] }>('SELECT enabled,roles FROM admins WHERE id=$1 FOR SHARE', [id]))
    .rows[0];
  if (!admin?.enabled) return 'disabled';
  const roles = (
    await client.query<{ permissionCodes: string[] }>(
      'SELECT permission_codes AS "permissionCodes" FROM admin_roles WHERE active AND name=ANY($1::text[]) FOR SHARE',
      [admin.roles],
    )
  ).rows;
  const permissions = new Set(roles.flatMap(role => role.permissionCodes));
  return permissions.has('projects.read') && permissions.has('projects.follow-up') ? 'active' : 'permission_revoked';
}

export async function eligibleAssignee(client: pg.PoolClient, id: string): Promise<boolean> {
  return (await assigneeState(client, id)) === 'active';
}

/** 新需求的承接人：默认承接人可承接时直接分配，否则进入待分配池并给出原因 */
export async function configuredAssignee(
  client: pg.PoolClient,
): Promise<{ assigneeAdminId: string; poolReason: null } | { assigneeAdminId: null; poolReason: PoolReason }> {
  const config = (
    await client.query<{ id: string | null }>(
      'SELECT default_assignee_admin_id AS id FROM project_assignment_config WHERE id=true FOR SHARE',
    )
  ).rows[0];
  if (!config) throw new Error('project_assignment_config row is missing');
  if (!config.id) return { assigneeAdminId: null, poolReason: 'unconfigured' };
  const state = await assigneeState(client, config.id);
  return state === 'active' ? { assigneeAdminId: config.id, poolReason: null } : { assigneeAdminId: null, poolReason: state };
}

/** 可被指派为承接人的管理员（启用且具备承接所需权限） */
export async function listAssignableAdmins(db: Pick<pg.Pool, 'query'>): Promise<{ id: string; name: string }[]> {
  return (
    await db.query<{ id: string; name: string }>(`SELECT a.id,coalesce(a.nickname,a.username) AS name FROM admins a
    WHERE a.enabled AND ${assigneePermissionSql('a')} ORDER BY a.username,a.id`)
  ).rows;
}
