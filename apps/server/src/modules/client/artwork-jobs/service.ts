import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type pg from 'pg';
import { listAiModels, type AiModelConfig } from '../../../infra/ai-models.js';
import { transaction } from '../../../infra/database.js';
import type { createStorage } from '../../../infra/storage.js';
import { getActivePromptTemplate } from '../../admin/prompt-templates/service.js';
import { digest, projectError } from '../../projects/domain.js';
import type { AssetSnapshot } from '../../projects/snapshot.js';
import type { ThemeInput } from '../theme-jobs/service.js';

export const DIRECTIONS = ['front', 'back', 'left', 'right'] as const;
export type Direction = typeof DIRECTIONS[number];
export const DIRECTION_LABELS: Record<Direction, string> = { front: '正面', back: '背面', left: '左侧', right: '右侧' };
export const ARTWORK_QUALITY = { minLongEdge: 1536, minShortEdge: 1024, maxPixels: 40_000_000, maxBytes: 30 * 1024 * 1024 };
export type ArtworkContext = { schemeCode: string; themeJobId: string; resultId: string; selectionRevision: number };
type Database = Pick<pg.Pool, 'query'>;
export type ArtworkSnapshot = {
  source: { assetId: string; versionId: string; objectKey: string; checksum: string };
  input: ThemeInput; prompt: string; template: { id: string; revision: number; body: string } | null;
  model: Pick<AiModelConfig, 'provider' | 'model' | 'revision' | 'unitCredits'>;
  quality: typeof ARTWORK_QUALITY; pipelineRevision: number;
};
export type ArtworkOffer = ArtworkContext & { userId: string; snapshot: ArtworkSnapshot; unitCredits: number; expiresAt: string };
type JobSummary = { id: string; status: string; deliveryStatus: string; unitCredits: number | null; usableCount: number; requestHash: string };

export function artworkHash(context: ArtworkContext): string {
  return digest([context.schemeCode, context.themeJobId, context.resultId, context.selectionRevision]);
}
export function artworkCredits(job: Pick<JobSummary, 'status' | 'unitCredits' | 'usableCount'>) {
  const price = job.unitCredits ?? 0;
  const terminal = ['succeeded', 'partially_succeeded', 'failed'].includes(job.status);
  return { status: terminal ? job.usableCount ? 'settled' : 'released' : 'reserved', reservedCredits: price * 4,
    heldCredits: terminal ? 0 : price * 4, chargedCredits: terminal ? price * job.usableCount : 0,
    releasedCredits: terminal ? price * (4 - job.usableCount) : 0 };
}
function receipt(job: JobSummary, reusedRequest: boolean) {
  return { jobId: job.id, artworkJobId: job.id, status: job.status, deliveryStatus: job.deliveryStatus, reusedRequest,
    credits: artworkCredits(job), pollAfterMs: ['succeeded', 'partially_succeeded', 'failed'].includes(job.status) ? null : 2000 };
}
export async function replayArtworkRequest(database: Database, userId: string, requestKey: string, context: ArtworkContext) {
  const job = (await database.query<JobSummary>(`SELECT id,status,delivery_status AS "deliveryStatus",unit_credits AS "unitCredits",
    usable_count AS "usableCount",request_hash AS "requestHash" FROM artwork_jobs WHERE user_id=$1 AND request_key=$2`, [userId, requestKey])).rows[0];
  if (!job) return null;
  if (job.requestHash !== artworkHash(context)) throw projectError('REQUEST_CONFLICT');
  return receipt(job, true);
}
export async function assertThemeSelection(database: Database, userId: string, context: ArtworkContext, lock = false) {
  const job = (await database.query<{ input: ThemeInput; sourceAssetId: string; versionId: string; objectKey: string; checksum: string }>(
    `SELECT j.input,r.asset_id AS "sourceAssetId",v.id AS "versionId",v.object_key AS "objectKey",v.checksum
     FROM theme_jobs j JOIN theme_job_results r ON r.job_id=j.id AND r.id=j.selected_result_id
     JOIN scheme_assets a ON a.id=r.asset_id AND a.is_active
     JOIN asset_versions v ON v.id=r.asset_version_id AND v.asset_id=r.asset_id
     JOIN schemes s ON s.code=j.scheme_code AND s.id=a.scheme_id AND s.publish_status='published'
     WHERE j.id=$1 AND j.user_id=$2 AND j.scheme_code=$3 AND r.id=$4 AND j.selection_revision=$5
       AND j.status IN ('succeeded','partially_succeeded') AND v.byte_size>0${lock ? ' FOR UPDATE OF j' : ''}`,
    [context.themeJobId, userId, context.schemeCode, context.resultId, context.selectionRevision],
  )).rows[0];
  if (!job) throw projectError('THEME_SELECTION_CHANGED');
  return job;
}
export async function loadArtworkSnapshot(pool: pg.Pool, userId: string, context: ArtworkContext): Promise<ArtworkSnapshot> {
  const selected = await assertThemeSelection(pool, userId, context);
  const model = (await listAiModels(pool)).filter(m => m.purpose === 'artwork' && m.provider === 'openai' && m.enabled && m.credentialConfigured && m.unitCredits !== null && m.unitCredits > 0)
    .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider))[0];
  if (!model) throw projectError('MODEL_UNAVAILABLE');
  const labels = (await pool.query<{ id: string; label: string }>(`SELECT id::text AS id,item_label AS label FROM dictionary_items WHERE id=ANY($1::uuid[])`,
    [[selected.input.industryId, selected.input.styleId]])).rows;
  const industryLabel = labels.find(r => r.id === selected.input.industryId)?.label ?? '';
  const styleLabel = labels.find(r => r.id === selected.input.styleId)?.label ?? '';
  const template = await getActivePromptTemplate(pool, 'artwork', selected.input.industryId, selected.input.styleId);
  const values: Record<string, string> = { industryLabel, styleLabel, brandColors: selected.input.brandColors?.join(', ') ?? '', brandKeywords: selected.input.brandKeywords ?? '', directionLabel: '{{directionLabel}}' };
  const body = template?.body.replace(/{{(industryLabel|styleLabel|brandColors|brandKeywords|directionLabel)}}/g, (_match, key: string) => values[key] ?? '') ??
    `行业：${industryLabel}。风格：${styleLabel}。品牌色：${values.brandColors}。品牌关键词：${values.brandKeywords}。`;
  const prompt = `${body}\n以所选主题效果图为唯一视觉参考，生成展台的{{directionLabel}}正交立面方向底图。无透视、无斜视、不新增结构。四面必须沿用同一品牌形象、角色、图案、色彩、材质与风格。不要重新设计主题，不拼成四宫格，不添加标注和尺寸线。输出单张高清平面底图。`;
  return { source: { assetId: selected.sourceAssetId, versionId: selected.versionId, objectKey: selected.objectKey, checksum: selected.checksum }, input: selected.input,
    template: template ? { id: template.id, revision: template.revision, body: template.body } : null, prompt,
    model: { provider: model.provider, model: model.model, revision: model.revision, unitCredits: model.unitCredits }, quality: ARTWORK_QUALITY, pipelineRevision: 1 };
}
export async function createArtworkJob(pool: pg.Pool, userId: string, requestKey: string, offerId: string, context: ArtworkContext, offer: ArtworkOffer) {
  if (offer.userId !== userId || artworkHash(context) !== artworkHash(offer)) throw projectError('OFFER_MISMATCH');
  const snapshot = await loadArtworkSnapshot(pool, userId, context);
  if (digest(snapshot) !== digest(offer.snapshot)) throw projectError('OFFER_STALE');
  return transaction(pool, async client => {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const replay = await replayArtworkRequest(client, userId, requestKey, context);
    if (replay) return replay;
    await assertThemeSelection(client, userId, context, true);
    const currentModel = await client.query(`SELECT provider FROM ai_model_configs WHERE purpose='artwork' AND provider=$1
      AND revision=$2 AND enabled AND credential_ciphertext IS NOT NULL AND unit_credits=$3 FOR SHARE`, [snapshot.model.provider, snapshot.model.revision, offer.unitCredits]);
    if (!currentModel.rowCount) throw projectError('OFFER_STALE');
    if (snapshot.template) {
      const currentTemplate = await client.query('SELECT id FROM prompt_templates WHERE id=$1 AND revision=$2 AND enabled FOR SHARE', [snapshot.template.id, snapshot.template.revision]);
      if (!currentTemplate.rowCount) throw projectError('OFFER_STALE');
    }
    const balance = (await client.query<{ availableBalance: number }>(`SELECT (COALESCE(SUM(amount),0)-COALESCE(
      (SELECT SUM(reserved_amount) FROM credit_reservations WHERE user_id=$1 AND status='reserved'),0))::integer AS "availableBalance"
      FROM credit_transactions WHERE user_id=$1`, [userId])).rows[0]?.availableBalance ?? 0;
    if (balance < offer.unitCredits * 4) throw projectError('INSUFFICIENT_CREDITS', 402);
    const job = (await client.query<JobSummary>(`INSERT INTO artwork_jobs(user_id,scheme_code,source_asset_id,offer_id,request_key,input,requested_count,
      unit_credits,theme_job_id,theme_result_id,theme_selection_revision,request_hash,generation_snapshot,delivery_status)
      VALUES($1,$2,$3,$4,$5,$6,4,$7,$8,$9,$10,$11,$12,'pending')
      RETURNING id,status,delivery_status AS "deliveryStatus",unit_credits AS "unitCredits",usable_count AS "usableCount",request_hash AS "requestHash"`,
      [userId, context.schemeCode, snapshot.source.assetId, offerId, requestKey, JSON.stringify(snapshot.input), offer.unitCredits,
        context.themeJobId, context.resultId, context.selectionRevision, artworkHash(context), JSON.stringify(snapshot)])).rows[0];
    if (!job) throw new Error('Artwork task creation failed');
    for (const direction of DIRECTIONS) await client.query('INSERT INTO artwork_job_directions(job_id,direction) VALUES($1,$2)', [job.id, direction]);
    await client.query('INSERT INTO credit_reservations(user_id,artwork_job_id,reserved_amount) VALUES($1,$2,$3)', [userId, job.id, offer.unitCredits * 4]);
    await client.query('INSERT INTO artwork_job_outbox(job_id) VALUES($1)', [job.id]);
    return receipt(job, false);
  });
}

export interface ArtworkFile extends AssetSnapshot { direction: Direction; width: number; height: number; byteSize: number }
export async function artworkFiles(database: Database, jobId: string): Promise<ArtworkFile[]> {
  return (await database.query<ArtworkFile>(`SELECT r.direction,r.width,r.height,a.id AS "assetId",a.type,a.name,a.revision,a.metadata,
    v.id AS "versionId",v.object_key AS "objectKey",v.checksum,v.original_filename AS filename,v.mime_type AS "mimeType",v.byte_size::float8 AS "byteSize"
    FROM artwork_job_results r JOIN scheme_assets a ON a.id=r.asset_id
    JOIN asset_versions v ON v.id=r.asset_version_id AND v.asset_id=r.asset_id
    WHERE r.job_id=$1 AND r.direction IS NOT NULL ORDER BY r.ordinal`, [jobId])).rows;
}
export function completeArtworkFiles(files: ArtworkFile[]): boolean {
  return files.length === 4 && DIRECTIONS.every(d => files.filter(f => f.direction === d).length === 1) && files.every(f =>
    f.mimeType === 'image/png' && f.byteSize > 0 && f.byteSize <= ARTWORK_QUALITY.maxBytes &&
    Math.max(f.width, f.height) >= ARTWORK_QUALITY.minLongEdge && Math.min(f.width, f.height) >= ARTWORK_QUALITY.minShortEdge &&
    f.width * f.height <= ARTWORK_QUALITY.maxPixels && /^[a-f\d]{64}$/i.test(f.checksum));
}
export async function ownedArtworkJob(database: Database, userId: string, jobId: string) {
  const job = (await database.query<JobSummary & { schemeCode: string; themeJobId: string; resultId: string; selectionRevision: number; snapshot: ArtworkSnapshot; phase: string | null }>(
    `SELECT id,status,delivery_status AS "deliveryStatus",unit_credits AS "unitCredits",usable_count AS "usableCount",scheme_code AS "schemeCode",
      theme_job_id AS "themeJobId",theme_result_id AS "resultId",theme_selection_revision AS "selectionRevision",generation_snapshot AS snapshot,phase
     FROM artwork_jobs WHERE id=$1 AND user_id=$2`, [jobId, userId])).rows[0];
  if (!job) throw projectError('ARTWORK_NOT_FOUND', 404);
  return job;
}
export async function getArtworkJob(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'signDownload'>, userId: string, jobId: string) {
  const job = await ownedArtworkJob(pool, userId, jobId);
  const files = await artworkFiles(pool, jobId);
  const states = (await pool.query<{ direction: Direction; status: string; reason: string | null }>('SELECT direction,status,reason FROM artwork_job_directions WHERE job_id=$1', [jobId])).rows;
  const directions = await Promise.all(DIRECTIONS.map(async direction => {
    const file = files.find(f => f.direction === direction);
    const state = states.find(s => s.direction === direction);
    return { direction, status: state?.status ?? 'failed', reason: state?.reason ?? null,
      ...(file ? { assetId: file.assetId, width: file.width, height: file.height, byteSize: file.byteSize, filename: file.filename,
        previewUrl: await storage.signDownload(file.objectKey, 300) } : {}) };
  }));
  return { ...receipt(job, false), schemeCode: job.schemeCode, phase: job.phase,
    themeSelection: { themeJobId: job.themeJobId, resultId: job.resultId, selectionRevision: job.selectionRevision },
    referencePreviewUrl: job.snapshot ? await storage.signDownload(job.snapshot.source.objectKey, 300) : null,
    directions, missingDirections: DIRECTIONS.filter(d => !files.some(f => f.direction === d)), mappingStatus: 'unresolved', quality: ARTWORK_QUALITY };
}
export async function readyArtworkFiles(database: Database, userId: string, jobId: string, context: ArtworkContext) {
  const job = await ownedArtworkJob(database, userId, jobId);
  if (artworkHash(job) !== artworkHash(context)) throw projectError('ARTWORK_CONTEXT_MISMATCH');
  const files = await artworkFiles(database, jobId);
  if (job.deliveryStatus !== 'ready' || !completeArtworkFiles(files)) throw projectError('ARTWORK_INCOMPLETE');
  return files;
}
export async function artworkArchive(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'getBuffer'>, userId: string, jobId: string) {
  const job = await ownedArtworkJob(pool, userId, jobId);
  const files = await readyArtworkFiles(pool, userId, jobId, job);
  const zip = new JSZip();
  try {
    for (const file of files) {
      const bytes = await storage.getBuffer(file.objectKey, file.byteSize);
      if (bytes.length !== file.byteSize || createHash('sha256').update(bytes).digest('hex') !== file.checksum) throw new Error('Artwork integrity mismatch');
      zip.file(`${file.direction}.png`, bytes);
    }
    return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }),
      filename: `${job.schemeCode.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}@四面素材-${jobId.slice(0, 8)}.zip` };
  } catch { throw projectError('ARTWORK_STORAGE_UNAVAILABLE', 503); }
}
