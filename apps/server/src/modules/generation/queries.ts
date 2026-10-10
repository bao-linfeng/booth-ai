import type pg from 'pg';
import { domainError } from '../../lib/errors.js';
import { getJobCreditLedger } from '../credits/management-service.js';
import { artworkFiles } from './artwork/queries.js';
import { DIRECTIONS, type ArtworkSnapshot } from './artwork/types.js';

export interface GenerationJobQuery {
  page?: number;
  pageSize?: number;
  jobType?: 'theme' | 'artwork';
  status?: 'pending' | 'queued' | 'running' | 'settling' | 'succeeded' | 'partially_succeeded' | 'failed';
  userId?: string;
  schemeCode?: string;
  from?: string;
  to?: string;
  /** 只看积分对账无法自动修复的任务。 */
  creditIssue?: boolean;
}

interface JobRow {
  jobType?: 'theme' | 'artwork';
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
  cacheHit: boolean;
  selectionRevision: number;
  selectedResultId: string | null;
  input: unknown;
  creditIssue: string | null;
  creditIssueAt: Date | null;
  /** 实际调用的 AI 模型 ID。 */
  aiModels: string[];
  createdAt: Date;
  updatedAt: Date;
  /** 首次进入终态的时间；进行中的任务为 null。 */
  completedAt: Date | null;
}

const listColumns = `j.id,j.user_id AS "userId",u.username AS "username",j.scheme_code AS "schemeCode",j.status,j.phase,
  j.requested_count AS "requestedCount",j.usable_count AS "usableCount",j.unit_credits AS "unitCredits",
  j.cache_hit AS "cacheHit",j.input,j.credit_issue AS "creditIssue",j.credit_issue_at AS "creditIssueAt",
  j.created_at AS "createdAt",j.updated_at AS "updatedAt",j.completed_at AS "completedAt"`;

// 主题任务取成功出图的模型；全部失败时取最后一次尝试的模型。早期任务没有尝试记录，返回空数组。
const themeModels = (job: string) => `COALESCE(
  (SELECT array_agg(DISTINCT a.model ORDER BY a.model) FROM theme_job_provider_attempts a WHERE a.job_id = ${job}.id AND a.status = 'succeeded'),
  (SELECT ARRAY[a.model] FROM theme_job_provider_attempts a WHERE a.job_id = ${job}.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1),
  '{}'::text[])`;
const artworkModels = (job: string) => `array_remove(ARRAY[${job}.generation_snapshot->'model'->>'model'], NULL)`;

function jobMetrics<T extends Pick<JobRow, 'usableCount' | 'unitCredits' | 'createdAt' | 'completedAt' | 'cacheHit' | 'jobType' | 'status'>>(row: T) {
  return {
    ...row,
    jobType: row.jobType ?? 'theme' as const,
    totalCreditsConsumed: row.cacheHit || !['succeeded','partially_succeeded'].includes(row.status) ? 0 : row.unitCredits === null ? null : row.usableCount * row.unitCredits,
    // 从创建到出结果的实际耗时；updated_at 会被选定效果等后续操作刷新，不能用来计算。
    durationMs: row.completedAt === null ? null : new Date(row.completedAt).getTime() - new Date(row.createdAt).getTime(),
  };
}

export async function listGenerationJobs(pool: pg.Pool, params: GenerationJobQuery) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const source = params.jobType === 'theme' ? 'theme_jobs' : params.jobType === 'artwork' ?
    "(SELECT a.*,false AS cache_hit,'artwork'::text AS job_type FROM artwork_jobs a)" :
    `(SELECT id,user_id,scheme_code,status::text,phase,requested_count,usable_count,unit_credits,cache_hit,input,credit_issue,credit_issue_at,created_at,updated_at,completed_at,'theme'::text AS job_type FROM theme_jobs
      UNION ALL SELECT id,user_id,scheme_code,status::text,phase,requested_count,usable_count,unit_credits,false,input,credit_issue,credit_issue_at,created_at,updated_at,completed_at,'artwork'::text FROM artwork_jobs)`;
  const typeColumn = params.jobType === 'theme' ? "'theme' AS \"jobType\"" : 'j.job_type AS "jobType"';
  const modelsColumn = `CASE WHEN ${params.jobType === 'theme' ? "'theme'" : 'j.job_type'} = 'theme' THEN ${themeModels('j')}
    ELSE (SELECT ${artworkModels('aw')} FROM artwork_jobs aw WHERE aw.id = j.id) END AS "aiModels"`;

  const values: unknown[] = [];
  const filters: string[] = [];
  if (params.status) { values.push(params.status); filters.push(`j.status = $${values.length}`); }
  if (params.userId) { values.push(params.userId); filters.push(`j.user_id = $${values.length}`); }
  if (params.schemeCode) { values.push(params.schemeCode); filters.push(`j.scheme_code = $${values.length}`); }
  if (params.from) { values.push(params.from); filters.push(`j.created_at >= $${values.length}::date`); }
  if (params.to) { values.push(params.to); filters.push(`j.created_at < ($${values.length}::date + interval '1 day')`); }
  if (params.creditIssue !== undefined) filters.push(`j.credit_issue IS ${params.creditIssue ? 'NOT ' : ''}NULL`);
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const [records, count] = await Promise.all([
    pool.query<JobRow>(`SELECT ${listColumns},${typeColumn},${modelsColumn} FROM ${source} j LEFT JOIN users u ON u.id = j.user_id${where} ORDER BY j.created_at DESC,j.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM ${source} j${where}`, values),
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
    j.selected_result_id AS "selectedResultId",${themeModels('j')} AS "aiModels" FROM theme_jobs j LEFT JOIN users u ON u.id = j.user_id WHERE j.id=$1`, [jobId])).rows[0];
  if (!job) return getArtworkGenerationJob(pool, jobId, storage);

  const input = job.input as { industryId?: string; styleId?: string };
  const [resultRows, labelRows, sourceRows, credits] = await Promise.all([
    pool.query<{ id: string; ordinal: number; assetId: string; objectKey: string; width: number | null; height: number | null; createdAt: Date }>(
      `SELECT r.id,r.ordinal,r.asset_id AS "assetId",v.object_key AS "objectKey",r.width,r.height,
       r.created_at AS "createdAt" FROM theme_job_results r
       JOIN asset_versions v ON v.id=r.asset_version_id AND v.asset_id=r.asset_id
       WHERE r.job_id=$1 ORDER BY r.ordinal ASC,r.id ASC`, [jobId]),
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
    getJobCreditLedger(pool, { kind: 'theme', id: jobId }),
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
  const results = await Promise.all(resultRows.rows.map(async ({ objectKey: key, ...result }) => {
    let previewUrl: string | null = null;
    if (storage && key) {
      try { previewUrl = await storage.signDownload(key, 300); } catch {}
    }
    return { ...result, previewUrl };
  }));
  return { ...jobMetrics(job), results, isSelected: job.selectedResultId !== null,
    industryLabel, styleLabel, sourcePreviewUrl, credits };
}

async function getArtworkGenerationJob(pool: pg.Pool, jobId: string, storage?: { signDownload: (key: string, expiresIn: number) => Promise<string> } | null) {
  const job = (await pool.query<JobRow & { snapshot: ArtworkSnapshot | null; deliveryStatus: string; themeJobId: string; themeResultId: string; themeSelectionRevision: number }>(
    `SELECT ${listColumns},j.source_asset_id AS "sourceAssetId",j.offer_id AS "offerId",j.request_key AS "requestKey",j.cache_mode AS "cacheMode",
      j.selection_revision AS "selectionRevision",j.selected_result_id AS "selectedResultId",j.generation_snapshot AS snapshot,
      j.delivery_status AS "deliveryStatus",${artworkModels('j')} AS "aiModels",j.theme_job_id AS "themeJobId",j.theme_result_id AS "themeResultId",j.theme_selection_revision AS "themeSelectionRevision"
      FROM (SELECT a.*,false AS cache_hit FROM artwork_jobs a) j LEFT JOIN users u ON u.id=j.user_id WHERE j.id=$1`, [jobId])).rows[0];
  if (!job) throw domainError('RESOURCE_NOT_FOUND', 404);
  const [files, credits] = await Promise.all([artworkFiles(pool, jobId), getJobCreditLedger(pool, { kind: 'artwork', id: jobId })]);
  const directions = (await pool.query<{ direction: string; status: string; reason: string | null }>('SELECT direction,status,reason FROM artwork_job_directions WHERE job_id=$1 ORDER BY direction', [jobId])).rows;
  const { snapshot, ...publicJob } = job;
  return { ...jobMetrics({ ...publicJob, jobType: 'artwork' }), isSelected: false, industryLabel: null, styleLabel: null,
    sourcePreviewUrl: storage && snapshot ? await storage.signDownload(snapshot.source.objectKey, 300) : null,
    generationSnapshot: snapshot ? { model: snapshot.model, template: snapshot.template, prompt: snapshot.prompt, directionPrompts: snapshot.directionPrompts, quality: snapshot.quality, pipelineRevision: snapshot.pipelineRevision } : null,
    themeSelection: { themeJobId: job.themeJobId, resultId: job.themeResultId, selectionRevision: job.themeSelectionRevision },
    credits, directions, missingDirections: DIRECTIONS.filter(d => !files.some(f => f.direction === d)), mappingStatus: 'unresolved',
    results: await Promise.all(files.map(async (file, index) => ({ id: file.assetId, ordinal: index + 1, direction: file.direction, assetId: file.assetId,
      width: file.width, height: file.height, previewUrl: storage ? await storage.signDownload(file.objectKey, 300) : null, createdAt: job.updatedAt }))) };
}
