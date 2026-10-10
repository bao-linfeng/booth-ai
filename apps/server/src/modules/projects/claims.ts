import type pg from 'pg';

// 未登录提交的项目以联系邮箱待认领；灵通注册会验证邮箱，登录时按账号邮箱把项目归属到该用户。
// 已有归属的项目不受影响，同一项目只会被认领一次。
export async function claimAnonymousProjects(db: pg.Pool | pg.PoolClient, userId: string, email: string | null): Promise<string[]> {
  const claimEmail = email?.trim().toLowerCase();
  if (!claimEmail) return [];
  const rows = (
    await db.query<{ projectId: string }>(
      `WITH claimed AS (
      UPDATE projects SET customer_user_id=$1 WHERE customer_user_id IS NULL AND claim_email=$2 RETURNING id
    ) INSERT INTO project_events(project_id,kind,payload)
      SELECT id,'claimed',jsonb_build_object('customerUserId',$1::text) FROM claimed RETURNING project_id AS "projectId"`,
      [userId, claimEmail],
    )
  ).rows;
  return rows.map(row => row.projectId);
}
