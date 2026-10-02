import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type pg from 'pg';
import sharp from 'sharp';
import type { Config } from '../../../config.js';
import { activeAiModels } from '../../../infra/ai-models.js';
import { transaction } from '../../../infra/database.js';
import { getActivePromptTemplate } from '../../prompts/service.js';
import type { createStorage } from '../../../infra/storage.js';
import { normalizeThemeInput, type GenerationSnapshot, type ThemeInput } from './service.js';
import { buildThemePrompt } from './prompt.js';
import { lockCreditJob, releaseJobCredits, settleJobCredits, terminalCreditJob } from '../../credits/service.js';
import { claimGeneration, publishGeneration, refreshGeneration } from '../execution.js';
import { downloadImage, editImage, IMAGE_LIMITS, ImageGenerationError, normalizeGeneratedImage, pollWanx } from '../../../infra/image-provider.js';

type ThemeConfig = Pick<Config, 'aiModelEncryptionKey' | 's3'>;
type ThemeJob = { requestedCount: number; sourceAssetId: string; schemeCode: string; input: ThemeInput; unitCredits: number | null; userId: string; status: string; snapshot: GenerationSnapshot | null };
type ProviderAttempt = { id: string; provider: string; model: string; revision: number; status: string; taskId: string | null };
type Publish = (jobId: string, event: unknown) => Promise<void>;

async function themeSource(database: pg.Pool, job: ThemeJob, storage: ReturnType<typeof createStorage>) {
  const key = job.snapshot?.source.objectKey ?? (await database.query<{ objectKey: string }>(
    `SELECT v.object_key AS "objectKey" FROM scheme_baseline_assets a
     JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.id = $1 AND a.is_active = true`, [job.sourceAssetId],
  )).rows[0]?.objectKey;
  if (!key) throw new ImageGenerationError('THEME_SOURCE_UNAVAILABLE');
  const reference = await storage.getBuffer(key, IMAGE_LIMITS.maxBytes);
  await normalizeGeneratedImage(reference);
  if (job.snapshot?.source.checksum && createHash('sha256').update(reference).digest('hex') !== job.snapshot.source.checksum) {
    throw new ImageGenerationError('THEME_SOURCE_INTEGRITY_INVALID');
  }
  let maskKey = job.snapshot?.mask?.objectKey;
  if (!job.snapshot) maskKey = (await database.query<{ objectKey: string }>(
    `SELECT v.object_key AS "objectKey" FROM scheme_baseline_assets a
     JOIN LATERAL (SELECT object_key FROM asset_versions WHERE asset_id = a.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
     WHERE a.related_asset_id = $1 AND a.type = 'mask' AND a.is_active = true LIMIT 1`, [job.sourceAssetId],
  )).rows[0]?.objectKey;
  let mask: Buffer | undefined;
  if (maskKey) {
    const bytes = await storage.getBuffer(maskKey, IMAGE_LIMITS.maxBytes);
    if (job.snapshot?.mask?.checksum && createHash('sha256').update(bytes).digest('hex') !== job.snapshot.mask.checksum) {
      throw new ImageGenerationError('THEME_MASK_INTEGRITY_INVALID');
    }
    const normalized = await normalizeGeneratedImage(bytes);
    const { data, info } = await sharp(normalized.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < info.width * info.height; i++) {
      data[i * 4 + 3] = data[i * 4]! > 200 && data[i * 4 + 1]! < 60 && data[i * 4 + 2]! > 200 ? 0 : 255;
    }
    mask = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }
  return { reference, mask, sourceUrl: await storage.signDownload(key, 900) };
}

async function persistGenerated(database: pg.Pool, jobId: string, lease: string, attemptId: string, urls: string[], count: number) {
  await transaction(database, async client => {
    const owner = await client.query("SELECT id FROM theme_jobs WHERE id = $1 AND lease_token = $2 AND status = 'running' FOR UPDATE", [jobId, lease]);
    if (!owner.rows[0]) throw new ImageGenerationError('GENERATION_LEASE_LOST_OR_EXPIRED');
    const saved = await client.query<{ ordinal: number }>('SELECT ordinal FROM theme_job_generated_urls WHERE job_id = $1 ORDER BY ordinal', [jobId]);
    const occupied = new Set(saved.rows.map(row => row.ordinal));
    let ordinal = 1;
    for (const url of urls.slice(0, Math.max(0, count - occupied.size))) {
      while (occupied.has(ordinal)) ordinal++;
      await client.query('INSERT INTO theme_job_generated_urls (job_id, ordinal, url) VALUES ($1, $2, $3)', [jobId, ordinal, url]);
      occupied.add(ordinal++);
    }
    await client.query("UPDATE theme_job_provider_attempts SET status = 'succeeded', updated_at = now() WHERE id = $1", [attemptId]);
    await client.query("UPDATE theme_jobs SET phase = 'result_persisted', updated_at = now() WHERE id = $1", [jobId]);
  });
}

async function generateTheme(database: pg.Pool, jobId: string, job: ThemeJob, lease: string, deadline: Date,
  config: ThemeConfig, storage: ReturnType<typeof createStorage>) {
  const saved = await database.query<{ ordinal: number; url: string }>('SELECT ordinal, url FROM theme_job_generated_urls WHERE job_id = $1 ORDER BY ordinal', [jobId]);
  const attempts = (await database.query<ProviderAttempt>(`SELECT id, provider, model, revision, status, provider_task_id AS "taskId"
    FROM theme_job_provider_attempts WHERE job_id = $1 ORDER BY created_at, id`, [jobId])).rows;
  const unresolved = attempts.find(attempt => attempt.status === 'waiting' || attempt.status === 'submitting' || attempt.status === 'unknown');
  if (unresolved?.status === 'submitting') {
    await database.query("UPDATE theme_job_provider_attempts SET status = 'unknown', reason = 'PROVIDER_OUTCOME_UNKNOWN', updated_at = now() WHERE id = $1", [unresolved.id]);
    return;
  }
  if (unresolved?.status === 'unknown') return;
  if (saved.rows.length && !unresolved) return;
  if (attempts.some(attempt => attempt.status === 'succeeded') && !unresolved) return;
  const activeModels = await activeAiModels(database, 'theme', config.aiModelEncryptionKey);
  if (unresolved?.status === 'waiting' && unresolved.taskId) {
    const model = activeModels.find(model => model.provider === unresolved.provider && model.model === unresolved.model && model.revision === unresolved.revision);
    if (!model) throw new ImageGenerationError('MODEL_UNAVAILABLE', true);
    await refreshGeneration(database, { kind: 'theme', id: jobId }, lease, 'provider_waiting');
    try {
      const urls = await pollWanx(model, unresolved.taskId, deadline);
      await persistGenerated(database, jobId, lease, unresolved.id, urls, job.requestedCount);
    } catch (error) {
      if (!(error instanceof ImageGenerationError) || error.retryable) throw error;
      await database.query("UPDATE theme_job_provider_attempts SET status = 'failed', reason = $2, updated_at = now() WHERE id = $1", [unresolved.id, error.code]);
    }
    return;
  }
  const models = job.snapshot ? job.snapshot.models.flatMap(snapshot => {
    const model = activeModels.find(active => active.provider === snapshot.provider && active.model === snapshot.model && active.revision === snapshot.revision);
    return model ? [model] : [];
  }) : activeModels;
  if (!models.length) return;
  let prompt = job.snapshot?.prompt;
  if (prompt === undefined) {
    const labels = await database.query<{ id: string; label: string }>('SELECT id::text AS id, item_label AS label FROM dictionary_items WHERE id IN ($1, $2)', [job.input.industryId, job.input.styleId]);
    const industry = labels.rows.find(row => row.id === job.input.industryId)?.label;
    const style = labels.rows.find(row => row.id === job.input.styleId)?.label;
    if (!industry || !style) throw new ImageGenerationError('THEME_DICTIONARY_UNAVAILABLE');
    const template = await getActivePromptTemplate(database, 'theme', job.input.industryId, job.input.styleId);
    prompt = buildThemePrompt(normalizeThemeInput(job.input), industry, style, template?.body);
  }
  const source = await themeSource(database, job, storage);
  let collected = 0;
  for (const model of models) {
    const prior = attempts.filter(attempt => attempt.provider === model.provider && attempt.model === model.model && attempt.revision === model.revision).length;
    for (let index = prior; index < 3; index++) {
      await refreshGeneration(database, { kind: 'theme', id: jobId }, lease, 'provider_submitting');
      const attemptId = randomUUID();
      await transaction(database, async client => {
        const owner = await client.query("SELECT id FROM theme_jobs WHERE id = $1 AND lease_token = $2 AND status = 'running' FOR UPDATE", [jobId, lease]);
        if (!owner.rows[0]) throw new ImageGenerationError('GENERATION_LEASE_LOST_OR_EXPIRED');
        await client.query(`INSERT INTO theme_job_provider_attempts(id, job_id, provider, model, revision, status)
          VALUES($1, $2, $3, $4, $5, 'submitting')`, [attemptId, jobId, model.provider, model.model, model.revision]);
      });
      let urls: string[];
      let submitted = false;
      try {
        urls = await editImage(model, source.reference, prompt, model.provider === 'gemini' ? 1 : job.requestedCount,
          deadline, { ...source, onSubmitted: async taskId => {
            submitted = true;
            await database.query("UPDATE theme_job_provider_attempts SET status = 'waiting', provider_task_id = $2, updated_at = now() WHERE id = $1", [attemptId, taskId]);
          } });
      } catch (error) {
        if (submitted) {
          if (error instanceof ImageGenerationError && !error.retryable && !error.outcomeUnknown && error.code === 'PROVIDER_GENERATION_FAILED') {
            await database.query("UPDATE theme_job_provider_attempts SET status = 'failed', reason = $2, updated_at = now() WHERE id = $1", [attemptId, error.code]);
            return;
          }
          throw error;
        }
        const classified = error instanceof ImageGenerationError ? error : new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
        await database.query('UPDATE theme_job_provider_attempts SET status = $2, reason = $3, updated_at = now() WHERE id = $1',
          [attemptId, classified.outcomeUnknown ? 'unknown' : 'failed', classified.code]);
        console.error('Theme provider attempt failed', { jobId, provider: model.provider, code: classified.code });
        if (classified.outcomeUnknown || collected > 0) return;
        if (!classified.retryable) break;
        if (index < 2) await delay(2000 * 2 ** index);
        continue;
      }
      await persistGenerated(database, jobId, lease, attemptId, urls, job.requestedCount);
      if (urls.length) {
        collected += urls.length;
        if (model.provider === 'gemini' && collected < job.requestedCount) {
          index--;
          continue;
        }
        return;
      }
      return;
    }
  }
}

export async function settleThemeJob(database: pg.Pool, jobId: string, lease?: string, publish: Publish = async () => {}) {
  const event = await transaction(database, async client => {
    const job = await lockCreditJob(client, { kind: 'theme', id: jobId });
    if (!job || terminalCreditJob(job.status)) return;
    if (lease ? job.leaseToken !== lease : job.leaseUntil && new Date(job.leaseUntil).getTime() > Date.now()) throw new ImageGenerationError('GENERATION_LEASE_BUSY', true);
    const results = await client.query<{ resultId: string; previewUrl: string }>('SELECT id AS "resultId", preview_url AS "previewUrl" FROM theme_job_results WHERE job_id = $1 ORDER BY ordinal', [jobId]);
    const usable = results.rows.length;
    await client.query(`UPDATE theme_job_provider_attempts SET status = 'unknown', reason = COALESCE(reason, 'PROVIDER_OUTCOME_UNKNOWN'),
      updated_at = now() WHERE job_id = $1 AND status IN ('submitting', 'waiting')`, [jobId]);
    if (usable) {
      if (job.unitCredits === null) throw new Error('Theme job price missing');
      await settleJobCredits(client, { kind: 'theme', id: jobId }, usable * job.unitCredits);
    }
    const status = usable === job.requestedCount ? 'succeeded' : usable ? 'partially_succeeded' : 'failed';
    await client.query('UPDATE theme_jobs SET status = $1, phase = NULL, usable_count = $2, lease_token = NULL, lease_until = NULL, updated_at = now() WHERE id = $3', [status, usable, jobId]);
    if (!usable) await releaseJobCredits(client, { kind: 'theme', id: jobId });
    return { status, results: results.rows };
  });
  if (event) await publishGeneration(publish, jobId, event);
}

export async function processThemeJob(database: pg.Pool, jobId: string, config: ThemeConfig,
  storage?: ReturnType<typeof createStorage>, publish: Publish = async () => {}): Promise<void> {
  if (!storage) throw new Error('Theme storage required');
  const claim = await claimGeneration(database, { kind: 'theme', id: jobId });
  if (!claim) return;
  const { lease, deadline } = claim;
  try {
    const job = (await database.query<ThemeJob>(`SELECT requested_count AS "requestedCount", source_asset_id AS "sourceAssetId", scheme_code AS "schemeCode", input,
      unit_credits AS "unitCredits", user_id AS "userId", status, generation_snapshot AS snapshot FROM theme_jobs WHERE id = $1`, [jobId])).rows[0];
    if (!job) throw new Error('Theme job not found');
    if (deadline.getTime() <= Date.now()) { await settleThemeJob(database, jobId, lease, publish); return; }
    await publishGeneration(publish, jobId, { status: 'running' });
    await generateTheme(database, jobId, job, lease, deadline, config, storage);
    const saved = await database.query<{ ordinal: number; url: string }>('SELECT ordinal, url FROM theme_job_generated_urls WHERE job_id = $1 ORDER BY ordinal', [jobId]);
    for (const { ordinal, url } of saved.rows) {
      const existing = await database.query('SELECT id FROM theme_job_results WHERE job_id = $1 AND ordinal = $2', [jobId, ordinal]);
      if (existing.rows[0]) continue;
      await refreshGeneration(database, { kind: 'theme', id: jobId }, lease, 'result_validating');
      let image: Awaited<ReturnType<typeof normalizeGeneratedImage>>;
      try { image = await normalizeGeneratedImage(await downloadImage(url, deadline)); }
      catch (error) {
        if (!(error instanceof ImageGenerationError) || error.retryable) throw error;
        console.error('Theme result rejected', { jobId, ordinal, code: error.code });
        continue;
      }
      await refreshGeneration(database, { kind: 'theme', id: jobId }, lease, 'result_persisting');
      const assetId = randomUUID(); const versionId = randomUUID(); const resultId = randomUUID();
      const objectKey = `theme-results/${jobId}/${ordinal}.png`;
      await storage.putBuffer(objectKey, image.bytes, 'image/png');
      const previewUrl = await storage.signDownload(objectKey, 900);
      await transaction(database, async client => {
        const owner = await client.query("SELECT id FROM theme_jobs WHERE id = $1 AND lease_token = $2 AND status = 'running' FOR UPDATE", [jobId, lease]);
        if (!owner.rows[0]) throw new ImageGenerationError('GENERATION_LEASE_LOST_OR_EXPIRED');
        await client.query(`INSERT INTO scheme_assets (id, scheme_id, type, name, sort_order, metadata, source, owner_user_id, visibility)
          SELECT $1, id, 'artwork', $2, $3, $4, 'theme_generation', $6, 'private' FROM schemes WHERE code = $5`,
        [assetId, `AI 换主题结果 ${ordinal}`, ordinal - 1, JSON.stringify({ themeJobId: jobId }), job.schemeCode, job.userId]);
        await client.query(`INSERT INTO asset_versions (id, asset_id, object_key, original_filename, mime_type, byte_size, checksum, width_px, height_px)
          VALUES ($1, $2, $3, $4, 'image/png', $5, $6, $7, $8)`,
        [versionId, assetId, objectKey, `${ordinal}.png`, image.bytes.length, createHash('sha256').update(image.bytes).digest('hex'), image.width, image.height]);
        await client.query(`INSERT INTO theme_job_results (id, job_id, ordinal, asset_id, preview_url, asset_version_id, width, height)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [resultId, jobId, ordinal, assetId, previewUrl, versionId, image.width, image.height]);
      });
    }
    await refreshGeneration(database, { kind: 'theme', id: jobId }, lease, 'credit_settling');
    await settleThemeJob(database, jobId, lease, publish);
  } finally {
    await database.query('UPDATE theme_jobs SET lease_token = NULL, lease_until = NULL WHERE id = $1 AND lease_token = $2', [jobId, lease]);
  }
}
