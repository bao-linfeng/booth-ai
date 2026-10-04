import type pg from 'pg';
import type { Config } from '../../config.js';
import { transaction } from '../../infra/database.js';
import { fetchExternalRoles } from '../../infra/external-auth.js';
import { allPermissionCodes, validatePermissionCodes } from './permissions.js';

export interface AdminRole {
  id: number;
  name: string;
  permissionCodes: string[];
  revision: number;
}

export async function resolveAdminPermissions(pool: pg.Pool | pg.PoolClient, roles: string[]): Promise<string[]> {
  if (roles.length === 0) return [];
  const result = await pool.query<{ code: string }>(`
    SELECT DISTINCT unnest(permission_codes) AS code FROM admin_roles WHERE active AND name=ANY($1::text[])
  `, [roles]);
  return result.rows.map(row => row.code).filter(code => allPermissionCodes.includes(code));
}

export async function requireAdminAccess(pool: pg.Pool, roles: string[]): Promise<string[]> {
  const permissions = await resolveAdminPermissions(pool, roles);
  if (permissions.length === 0) throw Object.assign(new Error('未授予后台访问权限'), { statusCode: 403, reason: 'ACCESS_DENIED' });
  return permissions;
}

export async function listAdminRoles(config: Config, pool: pg.Pool, jwt: string): Promise<AdminRole[]> {
  const roles = await fetchExternalRoles(config, jwt);
  return transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(19002402)');
    await client.query("UPDATE admin_roles SET active=false,permission_codes='{}',revision=revision+1,updated_at=now() WHERE active AND NOT (id=ANY($1::bigint[]))", [roles.map(role => role.id)]);
    for (const role of roles) {
      await client.query(`INSERT INTO admin_roles (id,name) VALUES ($1,$2)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,active=true,
          permission_codes=CASE WHEN admin_roles.name=EXCLUDED.name THEN admin_roles.permission_codes ELSE '{}'::text[] END,
          revision=admin_roles.revision+CASE WHEN admin_roles.name<>EXCLUDED.name OR NOT admin_roles.active THEN 1 ELSE 0 END,
          updated_at=now()`, [role.id, role.name]);
    }
    const result = await client.query<AdminRole>(`
      SELECT id::float8 AS id,name,permission_codes AS "permissionCodes",revision FROM admin_roles WHERE active ORDER BY id
    `);
    return result.rows;
  });
}

export async function getAdminRole(pool: pg.Pool, id: number): Promise<AdminRole> {
  const row = (await pool.query<AdminRole>(`
    SELECT id::float8 AS id,name,permission_codes AS "permissionCodes",revision FROM admin_roles WHERE id=$1 AND active
  `, [id])).rows[0];
  if (!row) throw Object.assign(new Error('角色不存在，请刷新角色列表'), { statusCode: 404 });
  return row;
}

export async function updateRolePermissions(pool: pg.Pool, id: number, codes: string[], expectedRevision: number, actorId: string): Promise<AdminRole> {
  const permissions = validatePermissionCodes(codes);
  return transaction(pool, async client => {
    const row = (await client.query<{ name: string; revision: number; permissionCodes: string[] }>(`
      SELECT name,revision,permission_codes AS "permissionCodes" FROM admin_roles WHERE id=$1 AND active FOR UPDATE
    `, [id])).rows[0];
    if (!row) throw Object.assign(new Error('角色不存在'), { statusCode: 404 });
    if (row.revision !== expectedRevision) throw Object.assign(new Error('角色权限已更新，请重新打开配置'), { statusCode: 409 });
    await client.query('UPDATE admin_roles SET permission_codes=$2,revision=revision+1,updated_at=now() WHERE id=$1', [id, permissions]);
    await client.query(`INSERT INTO admin_audit_logs (admin_id,action,target_type,target_id,detail)
      VALUES ($1,'role.permissions.update','role',$2,$3::jsonb)`, [actorId, String(id), JSON.stringify({ before: row.permissionCodes, after: permissions })]);
    return { id, name: row.name, permissionCodes: permissions, revision: row.revision + 1 };
  });
}
