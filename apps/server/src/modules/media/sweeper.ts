import type pg from 'pg';
import { errorCode, type Logger } from '../../infra/logger.js';
import type { createStorage } from '../../infra/storage.js';
import { createRenditions } from './renditions.js';

const BATCH_SIZE = 4;
// 方案效果图上传上限远小于此值；超过视为异常对象，不读入内存
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/**
 * 补齐缺少衍生图的图片版本：管理端上传、存量数据，以及入库时就地生成失败的结果。
 * 领取时先记一次尝试，进程中断或生成失败的条目 10 分钟后重试，最多 3 次；多副本靠 SKIP LOCKED 互不重复领取。
 * 领取条件与迁移 088 的部分索引保持一致。
 */
export async function processPendingRenditions(
  pool: pg.Pool,
  storage: Pick<ReturnType<typeof createStorage>, 'getBuffer' | 'putBuffer'>,
  log: Pick<Logger, 'warn'>,
): Promise<{ generated: number; failed: number }> {
  const claimed = await pool.query<{ id: string; objectKey: string }>(
    `UPDATE asset_versions v SET rendition_attempts = v.rendition_attempts + 1, rendition_attempted_at = now()
     WHERE v.id IN (
       SELECT id FROM asset_versions
       WHERE renditions IS NULL AND rendition_attempts < 3 AND byte_size > 0
         AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
         AND (rendition_attempted_at IS NULL OR rendition_attempted_at < now() - interval '10 minutes')
       ORDER BY created_at DESC, id LIMIT $1
       FOR UPDATE SKIP LOCKED)
     RETURNING v.id, v.object_key AS "objectKey"`,
    [BATCH_SIZE],
  );
  let generated = 0;
  let failed = 0;
  for (const row of claimed.rows) {
    try {
      const renditions = await createRenditions(storage, row.objectKey, await storage.getBuffer(row.objectKey, MAX_SOURCE_BYTES));
      await pool.query('UPDATE asset_versions SET renditions = $2 WHERE id = $1', [row.id, JSON.stringify(renditions)]);
      generated++;
    } catch (error) {
      failed++;
      log.warn({ versionId: row.id, code: errorCode(error) }, 'Image rendition failed');
    }
  }
  return { generated, failed };
}
