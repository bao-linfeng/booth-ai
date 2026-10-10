import type pg from 'pg';
import { bomError } from './errors.js';

// 参展商端只能看到已发布方案的清单；下载必须是页面展示时的已核验修订。

export async function assertSchemePublished(pool: Pick<pg.Pool, 'query'>, schemeCode: string): Promise<void> {
  const row = (await pool.query('SELECT 1 FROM schemes WHERE code = $1 AND publish_status = $2', [schemeCode, 'published'])).rows[0];
  if (!row) throw bomError('RESOURCE_NOT_FOUND', 404);
}

export async function assertCurrentPublishedBom(pool: Pick<pg.Pool, 'query'>, schemeCode: string, revision: number): Promise<void> {
  const row = (
    await pool.query<{ publishStatus: string; revision: number | null; status: string | null }>(
      `SELECT s.publish_status AS "publishStatus", b.revision, b.status
     FROM schemes s LEFT JOIN scheme_boms b ON b.scheme_id = s.id
     WHERE s.code = $1`,
      [schemeCode],
    )
  ).rows[0];
  if (!row || row.publishStatus !== 'published') throw bomError('RESOURCE_NOT_FOUND', 404);
  if (row.revision !== revision || row.status !== 'verified') throw bomError('BOM_REVISION_CHANGED', 409);
}
