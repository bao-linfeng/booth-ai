import type pg from 'pg';

export interface GenerationJobQuery {
  page?: number;
  pageSize?: number;
  jobType?: 'theme' | 'artwork';
  status?: 'pending' | 'queued' | 'running' | 'settling' | 'succeeded' | 'partially_succeeded' | 'failed';
  userId?: string;
  schemeCode?: string;
  from?: string;
  to?: string;
}

interface JobRow {
  id: string;
  userId: string;
  username: string | null;
  schemeCode: string;
  sourceAssetId: string;
  offerId: string;
  requestKey: string;
  status: string;
  phase: string | null;
  requestedCount: number;
  usableCount: number;
  unitCredits: number | null;
  cacheMode: string;
  selectionRevision: number;
  selectedResultId: string | null;
  input: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const listColumns = `j.id,j.user_id AS "userId",u.username AS "username",j.scheme_code AS "schemeCode",j.status,j.phase,
  j.requested_count AS "requestedCount",j.usable_count AS "usableCount",j.unit_credits AS "unitCredits",
  j.input,j.created_at AS "createdAt",j.updated_at AS "updatedAt"`;

function jobMetrics<T extends Pick<JobRow, 'usableCount' | 'unitCredits' | 'createdAt' | 'updatedAt'>>(row: T) {
  return {
    ...row,
    jobType: 'theme' as const,
    totalCreditsConsumed: row.unitCredits === null ? null : row.usableCount * row.unitCredits,
    durationMs: new Date(row.updatedAt).getTime() - new Date(row.createdAt).getTime(),
  };
}

export async function listGenerationJobs(pool: pg.Pool, params: GenerationJobQuery) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  if (params.jobType === 'artwork') return { data: [], total: 0, page, pageSize };

  const values: unknown[] = [];
  const filters: string[] = [];
  if (params.status) { values.push(params.status); filters.push(`j.status = $${values.length}`); }
  if (params.userId) { values.push(params.userId); filters.push(`j.user_id = $${values.length}`); }
  if (params.schemeCode) { values.push(params.schemeCode); filters.push(`j.scheme_code = $${values.length}`); }
  if (params.from) { values.push(params.from); filters.push(`j.created_at >= $${values.length}::date`); }
  if (params.to) { values.push(params.to); filters.push(`j.created_at < ($${values.length}::date + interval '1 day')`); }
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const [records, count] = await Promise.all([
    pool.query<JobRow>(`SELECT ${listColumns} FROM theme_jobs j LEFT JOIN users u ON u.id = j.user_id${where} ORDER BY j.created_at DESC,j.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM theme_jobs j${where}`, values),
  ]);
  return { data: records.rows.map(jobMetrics), total: Number(count.rows[0]?.total ?? 0), page, pageSize };
}

export async function getGenerationJob(
  pool: pg.Pool,
  jobId: string,
  storage?: { signDownload: (key: string, expiresIn: number) => Promise<string> } | null,
) {
  const job = (await pool.query<JobRow>(`SELECT ${listColumns},j.source_asset_id AS "sourceAssetId",j.offer_id AS "offerId",
    j.request_key AS "requestKey",j.cache_mode AS "cacheMode",j.selection_revision AS "selectionRevision",
    j.selected_result_id AS "selectedResultId" FROM theme_jobs j LEFT JOIN users u ON u.id = j.user_id WHERE j.id=$1`, [jobId])).rows[0];
  if (!job) throw Object.assign(new Error('Generation job not found'), { statusCode: 404, code: 'NOT_FOUND' });

  const input = job.input as { industryId?: string; styleId?: string };
  const [resultRows, labelRows, sourceRows] = await Promise.all([
    pool.query(`SELECT id,ordinal,asset_id AS "assetId",preview_url AS "previewUrl",width,height,
      created_at AS "createdAt" FROM theme_job_results WHERE job_id=$1 ORDER BY ordinal ASC,id ASC`, [jobId]),
    pool.query<{ id: string; label: string }>(
      'SELECT id::text AS id, item_label AS label FROM dictionary_items WHERE id = ANY($1::uuid[])',
      [[input.industryId, input.styleId].filter(Boolean)],
    ),
    pool.query<{ objectKey: string }>(`SELECT v.object_key AS "objectKey"
      FROM scheme_assets a
      JOIN LATERAL (
        SELECT object_key FROM asset_versions
        WHERE asset_id = a.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) v ON true
      WHERE a.id = $1 AND a.is_active = true`, [job.sourceAssetId]),
  ]);
  const industryLabel = labelRows.rows.find(label => label.id === input.industryId)?.label ?? null;
  const styleLabel = labelRows.rows.find(label => label.id === input.styleId)?.label ?? null;
  const objectKey = sourceRows.rows[0]?.objectKey;
  let sourcePreviewUrl: string | null = null;
  if (storage && objectKey) {
    try {
      sourcePreviewUrl = await storage.signDownload(objectKey, 300);
    } catch {
      // Preview is optional; signing failures must not block job details.
    }
  }
  return { ...jobMetrics(job), results: resultRows.rows, isSelected: job.selectedResultId !== null,
    industryLabel, styleLabel, sourcePreviewUrl };
}
