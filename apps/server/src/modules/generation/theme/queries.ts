import type pg from 'pg';

interface ThemeJobDetail {
  id: string;
  schemeCode: string;
  sourceAssetId: string;
  sourceObjectKey: string | null;
  status: string;
  phase: string | null;
  requestedCount: number;
  usableCount: number;
  selectedResultId: string | null;
  selectionRevision: number;
  unitCredits: number | null;
  input: unknown;
  cacheHit: boolean;
  createdAt: string;
  updatedAt: string;
  searchId: string | null;
}

function themeError(reason: string, statusCode: number) {
  return Object.assign(new Error(reason), { statusCode, reason });
}

export async function ownedThemeJob(pool: pg.Pool, userId: string, jobId: string): Promise<void> {
  if (!(await pool.query('SELECT 1 FROM theme_jobs WHERE id = $1 AND user_id = $2', [jobId, userId])).rows[0]) {
    throw themeError('RESOURCE_NOT_FOUND', 404);
  }
}

export async function getThemeJob(pool: pg.Pool, userId: string, jobId: string) {
  const job = (
    await pool.query<ThemeJobDetail>(
      `SELECT id, scheme_code AS "schemeCode", source_asset_id AS "sourceAssetId",
      COALESCE(generation_snapshot->'source'->>'objectKey',
        (SELECT av.object_key FROM asset_versions av WHERE av.asset_id = source_asset_id ORDER BY av.created_at DESC, av.id DESC LIMIT 1)) AS "sourceObjectKey",
      status, phase, requested_count AS "requestedCount", usable_count AS "usableCount",
      selected_result_id AS "selectedResultId", selection_revision AS "selectionRevision",
      unit_credits AS "unitCredits", cache_hit AS "cacheHit", input, created_at AS "createdAt", updated_at AS "updatedAt", search_id AS "searchId"
     FROM theme_jobs WHERE id = $1 AND user_id = $2`,
      [jobId, userId],
    )
  ).rows[0];
  if (!job) throw themeError('RESOURCE_NOT_FOUND', 404);
  const results = (
    await pool.query<{ id: string; ordinal: number; width: number | null; height: number | null; objectKey: string }>(
      `SELECT tjr.id, tjr.ordinal, tjr.width, tjr.height, av.object_key AS "objectKey"
     FROM theme_job_results tjr
     JOIN scheme_assets sa ON sa.id = tjr.asset_id
       AND sa.source = 'theme_generation' AND sa.visibility = 'private' AND sa.owner_user_id = $2
     JOIN asset_versions av ON av.id = tjr.asset_version_id AND av.asset_id = sa.id
     WHERE tjr.job_id = $1 ORDER BY tjr.ordinal`,
      [jobId, userId],
    )
  ).rows;
  return { job, results };
}

export async function selectThemeResult(pool: pg.Pool, userId: string, jobId: string, resultId: string, expectedRevision: number) {
  const job = (
    await pool.query<{ id: string; schemeCode: string; status: string; selectedResultId: string | null; selectionRevision: number }>(
      `SELECT id, scheme_code AS "schemeCode", status, selected_result_id AS "selectedResultId", selection_revision AS "selectionRevision"
     FROM theme_jobs WHERE id = $1 AND user_id = $2`,
      [jobId, userId],
    )
  ).rows[0];
  if (!job) throw themeError('RESOURCE_NOT_FOUND', 404);
  if (!['succeeded', 'partially_succeeded'].includes(job.status)) throw themeError('OPERATION_FORBIDDEN', 409);
  if (job.selectedResultId === resultId) {
    return { jobId, schemeCode: job.schemeCode, resultId, revision: job.selectionRevision, selectedAt: new Date().toISOString() };
  }
  if (job.selectionRevision !== expectedRevision) throw themeError('SELECTION_CONFLICT', 409);
  if (!(await pool.query('SELECT id FROM theme_job_results WHERE id = $1 AND job_id = $2', [resultId, jobId])).rows[0]) {
    throw themeError('RESOURCE_NOT_FOUND', 404);
  }
  const updated = (
    await pool.query<{ selectionRevision: number; updatedAt: string }>(
      `UPDATE theme_jobs SET selected_result_id = $1, selection_revision = selection_revision + 1, updated_at = now()
     WHERE id = $2 AND user_id = $3 AND selection_revision = $4
     RETURNING selection_revision AS "selectionRevision", updated_at AS "updatedAt"`,
      [resultId, jobId, userId, expectedRevision],
    )
  ).rows[0];
  if (!updated) throw themeError('SELECTION_CONFLICT', 409);
  return { jobId, schemeCode: job.schemeCode, resultId, revision: updated.selectionRevision, selectedAt: updated.updatedAt };
}

/** SSE 重连时补发的当前状态；不属于该用户的任务视为不存在 */
export async function themeJobStatus(
  pool: Pick<pg.Pool, 'query'>,
  userId: string,
  jobId: string,
): Promise<{ status: string; phase: string | null }> {
  const job = (
    await pool.query<{ status: string; phase: string | null }>('SELECT status, phase FROM theme_jobs WHERE id = $1 AND user_id = $2', [
      jobId,
      userId,
    ])
  ).rows[0];
  if (!job) throw new Error('Theme job not found');
  return job;
}
