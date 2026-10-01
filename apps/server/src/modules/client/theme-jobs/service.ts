import { createHash } from 'node:crypto';
import type pg from 'pg';
import { listAiModels, type AiModelConfig } from '../../../infra/ai-models.js';
import { transaction } from '../../../infra/database.js';
import { getActivePromptTemplate } from '../../admin/prompt-templates/service.js';

export type ThemeInput = { industryId: string; styleId: string; brandColors?: string[]; brandKeywords?: string };
export type ThemeParameters = {
  schemeCode: string; sourceAssetId: string; input: ThemeInput; requestedCount: number; cacheMode: 'reuse' | 'refresh';
};
export type AssetSnapshot = { assetId: string; versionId: string; objectKey: string; checksum: string };
export type GenerationSnapshot = {
  source: AssetSnapshot;
  mask: AssetSnapshot | null;
  models: Pick<AiModelConfig, 'provider' | 'model' | 'revision' | 'priority' | 'unitCredits'>[];
  template: { id: string; revision: number; body: string } | null;
  prompt: string;
  pipelineRevision: number;
};
export type ThemeOfferData = ThemeParameters & {
  userId: string; cacheKey: string; snapshot: GenerationSnapshot;
  unitCredits: number; pricingRevision: number; cacheHit: boolean; expiresAt: string;
};
type JobSummary = {
  id: string; status: string; cacheHit: boolean; requestedCount: number; usableCount: number;
  unitCredits: number | null;
};
type Database = Pick<pg.Pool, 'query'>;

export function normalizeThemeInput(input: ThemeInput): ThemeInput {
  const brandKeywords = input.brandKeywords?.trim() ?? '';
  if (/[\u0000-\u001f\u007f]/u.test(brandKeywords)) {
    throw Object.assign(new Error('Brand keywords contain control characters'), { statusCode: 400 });
  }
  return { industryId: input.industryId, styleId: input.styleId,
    brandColors: [...new Set((input.brandColors ?? []).map(color => color.toUpperCase()))], brandKeywords };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function themeRequestHash(parameters: ThemeParameters): string {
  return hash([parameters.schemeCode, parameters.sourceAssetId, normalizeThemeInput(parameters.input), parameters.requestedCount, parameters.cacheMode]);
}

export function themeCacheKey(userId: string, parameters: ThemeParameters, snapshot: GenerationSnapshot): string {
  return hash([userId, parameters.schemeCode, parameters.sourceAssetId, normalizeThemeInput(parameters.input),
    parameters.requestedCount, snapshot]);
}

export async function loadGenerationSnapshot(pool: pg.Pool, parameters: ThemeParameters): Promise<GenerationSnapshot> {
  const source = (await pool.query<AssetSnapshot>(
    `SELECT a.id AS "assetId", v.id AS "versionId", v.object_key AS "objectKey", v.checksum
     FROM scheme_assets a JOIN schemes s ON s.id = a.scheme_id
     JOIN LATERAL (SELECT * FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.id = $1 AND s.code = $2 AND s.publish_status = 'published' AND a.is_active AND a.type = 'rendering'`,
    [parameters.sourceAssetId, parameters.schemeCode],
  )).rows[0];
  if (!source) throw Object.assign(new Error('Theme source image unavailable'), { statusCode: 409, reason: 'SOURCE_UNAVAILABLE' });
  const mask = (await pool.query<AssetSnapshot>(
    `SELECT a.id AS "assetId", v.id AS "versionId", v.object_key AS "objectKey", v.checksum
     FROM scheme_assets a
     JOIN LATERAL (SELECT * FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.related_asset_id = $1 AND a.type = 'mask' AND a.is_active
     ORDER BY a.id LIMIT 1`, [parameters.sourceAssetId],
  )).rows[0] ?? null;
  const labels = (await pool.query<{ id: string; label: string }>(
    `SELECT i.id::text AS id, i.item_label AS label FROM dictionary_items i
     JOIN dictionaries d ON d.id = i.dictionary_id
     WHERE i.enabled AND d.enabled AND ((i.id = $1 AND d.code = 'industry') OR (i.id = $2 AND d.code = 'style'))`,
    [parameters.input.industryId, parameters.input.styleId],
  )).rows;
  const industryLabel = labels.find(row => row.id === parameters.input.industryId)?.label;
  const styleLabel = labels.find(row => row.id === parameters.input.styleId)?.label;
  if (!industryLabel || !styleLabel) throw Object.assign(new Error('Theme dictionary options unavailable'), { statusCode: 409 });
  const models = (await listAiModels(pool)).filter(model => model.purpose === 'theme' && model.enabled && model.credentialConfigured && model.unitCredits !== null)
    .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider))
    .map(({ provider, model, revision, priority, unitCredits }) => ({ provider, model, revision, priority, unitCredits }));
  if (!models.length) throw Object.assign(new Error('Theme models unavailable'), { statusCode: 409, reason: 'MODEL_UNAVAILABLE' });
  const template = await getActivePromptTemplate(pool, 'theme', parameters.input.industryId, parameters.input.styleId);
  const input = normalizeThemeInput(parameters.input);
  const prompt = template ? template.body.replace(/{{(brandColors|brandKeywords|industryLabel|styleLabel)}}/g, (_match, variable: string) => ({
    brandColors: input.brandColors?.join(', ') ?? '无', brandKeywords: input.brandKeywords ?? '无', industryLabel, styleLabel,
  })[variable] ?? '') :
    `请根据以下要求对展台展位图进行AI换主题处理：\n行业：${industryLabel}，风格：${styleLabel}，品牌色：${input.brandColors?.join('、') ?? '无'}，关键词：${input.brandKeywords ?? '无'}\n保持展台结构不变，仅替换主题风格、色彩和装饰元素。`;
  return { source, mask, models, template: template ? { id: template.id, revision: template.revision, body: template.body } : null, prompt, pipelineRevision: 1 };
}

export async function findCachedThemeJob(database: Database, userId: string, cacheKey: string, requestedCount: number): Promise<string | null> {
  const result = await database.query<{ id: string }>(
    `SELECT j.id FROM theme_jobs j
     WHERE j.user_id = $1 AND j.cache_key = $2 AND j.status = 'succeeded' AND NOT j.cache_hit
       AND j.requested_count = $3 AND j.usable_count = $3
       AND (SELECT count(*) FROM theme_job_results r
            JOIN scheme_assets a ON a.id = r.asset_id AND a.is_active
            JOIN asset_versions v ON v.id = r.asset_version_id AND v.asset_id = a.id
            WHERE r.job_id = j.id) = $3
     ORDER BY j.created_at DESC, j.id DESC LIMIT 1`, [userId, cacheKey, requestedCount],
  );
  return result.rows[0]?.id ?? null;
}

export function themeCredits(job: Pick<JobSummary, 'cacheHit' | 'status' | 'requestedCount' | 'usableCount' | 'unitCredits'>) {
  if (job.cacheHit) return { status: 'not_charged', reservedCredits: 0, heldCredits: 0, chargedCredits: 0, releasedCredits: 0 };
  const unitCredits = job.unitCredits ?? 0;
  const terminal = ['succeeded', 'partially_succeeded', 'failed'].includes(job.status);
  return { status: terminal ? job.status === 'failed' ? 'released' : 'settled' : job.status === 'settling' ? 'settling' : 'reserved',
    reservedCredits: unitCredits * job.requestedCount, heldCredits: terminal ? 0 : unitCredits * job.requestedCount,
    chargedCredits: terminal ? unitCredits * job.usableCount : 0,
    releasedCredits: terminal ? unitCredits * (job.requestedCount - job.usableCount) : 0 };
}

function submission(job: JobSummary, reusedRequest: boolean) {
  return { jobId: job.id, status: job.status, reusedRequest, cacheHit: job.cacheHit, credits: themeCredits(job),
    pollAfterMs: ['succeeded', 'partially_succeeded', 'failed'].includes(job.status) ? null : 2000 };
}

export async function replayThemeRequest(database: Database, userId: string, requestKey: string, parameters: ThemeParameters) {
  const job = (await database.query<JobSummary & ThemeParameters>(
    `SELECT id, status, cache_hit AS "cacheHit", requested_count AS "requestedCount", usable_count AS "usableCount",
            unit_credits AS "unitCredits", scheme_code AS "schemeCode", source_asset_id AS "sourceAssetId", input, cache_mode AS "cacheMode"
     FROM theme_jobs WHERE user_id = $1 AND request_key = $2`, [userId, requestKey],
  )).rows[0];
  if (!job) return null;
  if (themeRequestHash(job) !== themeRequestHash(parameters)) {
    throw Object.assign(new Error('Request key already used with different parameters'), { statusCode: 409, reason: 'REQUEST_CONFLICT' });
  }
  return submission(job, true);
}

export async function createThemeJob(pool: pg.Pool, userId: string, requestKey: string, offerId: string,
  parameters: ThemeParameters, offer: ThemeOfferData) {
  if (offer.userId !== userId || themeRequestHash(offer) !== themeRequestHash(parameters)) {
    throw Object.assign(new Error('Submitted parameters do not match the offer'), { statusCode: 409, reason: 'OFFER_MISMATCH' });
  }
  const snapshot = await loadGenerationSnapshot(pool, parameters);
  const cacheKey = themeCacheKey(userId, parameters, snapshot);
  if (cacheKey !== offer.cacheKey) throw Object.assign(new Error('Generation configuration changed; obtain a new offer'), { statusCode: 409, reason: 'OFFER_STALE' });
  return transaction(pool, async client => {
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const replay = await replayThemeRequest(client, userId, requestKey, parameters);
    if (replay) return replay;
    const cachedJobId = parameters.cacheMode === 'reuse' ? await findCachedThemeJob(client, userId, cacheKey, parameters.requestedCount) : null;
    if (offer.cacheHit && !cachedJobId) {
      throw Object.assign(new Error('Cached result unavailable; obtain a new offer'), { statusCode: 409, reason: 'OFFER_STALE' });
    }
    const requiredCredits = cachedJobId ? 0 : offer.unitCredits * parameters.requestedCount;
    if (!cachedJobId) {
      const balance = (await client.query<{ availableBalance: number }>(
        `SELECT (COALESCE(SUM(ct.amount), 0) - COALESCE(
           (SELECT SUM(cr.reserved_amount) FROM credit_reservations cr WHERE cr.user_id = $1 AND cr.status = 'reserved'), 0
         ))::integer AS "availableBalance" FROM credit_transactions ct WHERE ct.user_id = $1`, [userId],
      )).rows[0]?.availableBalance ?? 0;
      if (balance < requiredCredits) throw Object.assign(new Error('Insufficient credits for this request'), { statusCode: 402 });
    }
    const job = (await client.query<JobSummary>(
      `INSERT INTO theme_jobs
       (user_id, scheme_code, source_asset_id, offer_id, request_key, input, requested_count, cache_mode, status,
        unit_credits, cache_key, generation_snapshot, cache_hit, cached_from_job_id, usable_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, status, cache_hit AS "cacheHit", requested_count AS "requestedCount", usable_count AS "usableCount",
                 unit_credits AS "unitCredits"`,
      [userId, parameters.schemeCode, parameters.sourceAssetId, offerId, requestKey, JSON.stringify(normalizeThemeInput(parameters.input)),
        parameters.requestedCount, parameters.cacheMode, cachedJobId ? 'succeeded' : 'pending', offer.unitCredits, cacheKey,
        JSON.stringify(snapshot), Boolean(cachedJobId), cachedJobId, cachedJobId ? parameters.requestedCount : 0],
    )).rows[0];
    if (!job) throw new Error('Failed to create theme job');
    if (cachedJobId) {
      const copied = await client.query(
        `INSERT INTO theme_job_results (job_id, ordinal, asset_id, asset_version_id, width, height)
         SELECT $1, r.ordinal, r.asset_id, r.asset_version_id, r.width, r.height
         FROM theme_job_results r JOIN scheme_assets a ON a.id = r.asset_id AND a.is_active
         JOIN asset_versions v ON v.id = r.asset_version_id AND v.asset_id = a.id
         WHERE r.job_id = $2 RETURNING id`, [job.id, cachedJobId],
      );
      if (copied.rowCount !== parameters.requestedCount) throw Object.assign(new Error('Cached result unavailable'), { statusCode: 409, reason: 'OFFER_STALE' });
    } else {
      await client.query('INSERT INTO theme_job_outbox (job_id) VALUES ($1) ON CONFLICT DO NOTHING', [job.id]);
      await client.query('INSERT INTO credit_reservations (user_id, theme_job_id, reserved_amount) VALUES ($1,$2,$3)', [userId, job.id, requiredCredits]);
    }
    return submission(job, false);
  });
}
