import type pg from 'pg';

/**
 * 将已发布方案设为 draft 并递增 revision。
 * 仅当 publish_status = 'published' 时触发，其他状态直接返回 false。
 * 同时 reset verification_status = 'unverified'。
 * 必须在已持有方案行锁（FOR UPDATE）的事务内调用。
 */
export async function invalidatePublication(
  client: pg.PoolClient,
  schemeId: string,
  updatedBy: string | null,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE schemes SET publish_status='draft', verification_status='unverified', revision=revision+1, updated_by=$2, updated_at=now() WHERE id=$1 AND publish_status='published'`,
    [schemeId, updatedBy],
  );
  return (result.rowCount ?? 0) > 0;
}
