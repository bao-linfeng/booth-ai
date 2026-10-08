import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type pg from 'pg';
import { imageAdapter } from '../../../infra/ai/protocols.js';
import { activeAiModels } from '../../../infra/ai/config.js';
import { ImageGenerationError } from '../../../infra/ai/image.js';
import type { ActiveAiModel, ImageEditRequest, ImageModelAdapter } from '../../../infra/ai/types.js';
import { transaction } from '../../../infra/database.js';
import { lockRunningLease, refreshGeneration, throwIfDraining } from '../execution.js';
import { loadThemeSource, resolveThemePrompt } from './source.js';
import type { ThemeRun } from './types.js';

const MAX_ATTEMPTS_PER_MODEL = 3;
const RETRY_BASE_DELAY_MS = 2000;

type ProviderAttempt = { id: string; modelId: string | null; revision: number; status: string; taskId: string | null };
/** 单次供应商调用的结果：`generated` 已拿到图片；`halt` 表示任务应停止；`failed` 表示未提交成功，由调用方决定重试或换模型。 */
type AttemptOutcome =
  | { kind: 'generated'; attemptId: string; providerRequestId: string | undefined; urls: string[] }
  | { kind: 'halt' }
  | { kind: 'failed'; error: ImageGenerationError };

async function loadAttempts(database: pg.Pool, jobId: string) {
  return (await database.query<ProviderAttempt>(`SELECT id, model_id AS "modelId", revision, status, provider_task_id AS "taskId"
    FROM theme_job_provider_attempts WHERE job_id = $1 ORDER BY created_at, id`, [jobId])).rows;
}

async function markAttemptFailed(database: pg.Pool, attemptId: string, code: string) {
  await database.query("UPDATE theme_job_provider_attempts SET status = 'failed', reason = $2, updated_at = now() WHERE id = $1", [attemptId, code]);
}

/** 把供应商返回的 URL 按空位顺序落库（幂等补齐到请求数量），并将尝试与任务阶段标记为已持久化。 */
async function persistGeneratedUrls(run: ThemeRun, attemptId: string, urls: string[]) {
  const { database, jobId, lease } = run;
  await transaction(database, async client => {
    await lockRunningLease(client, { kind: 'theme', id: run.jobId }, lease);
    const saved = await client.query<{ ordinal: number }>('SELECT ordinal FROM theme_job_generated_urls WHERE job_id = $1 ORDER BY ordinal', [jobId]);
    const occupied = new Set(saved.rows.map(row => row.ordinal));
    let ordinal = 1;
    for (const url of urls.slice(0, Math.max(0, run.job.requestedCount - occupied.size))) {
      while (occupied.has(ordinal)) ordinal++;
      await client.query('INSERT INTO theme_job_generated_urls (job_id, ordinal, url) VALUES ($1, $2, $3)', [jobId, ordinal, url]);
      occupied.add(ordinal++);
    }
    await client.query("UPDATE theme_job_provider_attempts SET status = 'succeeded', updated_at = now() WHERE id = $1", [attemptId]);
    await client.query("UPDATE theme_jobs SET phase = 'result_persisted', updated_at = now() WHERE id = $1", [jobId]);
  });
}

/** 恢复上次已提交的异步任务：只轮询既有 task，不重复提交；不可重试的失败仅标记该尝试。 */
async function resumeWaitingAttempt(run: ThemeRun, attempt: ProviderAttempt & { taskId: string }, activeModels: ActiveAiModel[]) {
  const model = activeModels.find(active => active.id === attempt.modelId && active.revision === attempt.revision);
  if (!model) throw new ImageGenerationError('MODEL_UNAVAILABLE', true);
  await refreshGeneration(run.database, { kind: 'theme', id: run.jobId }, run.lease, 'provider_waiting');
  try {
    const adapter = imageAdapter(model);
    if (!adapter.poll) throw new ImageGenerationError('PROVIDER_UNSUPPORTED');
    const urls = await adapter.poll(model, attempt.taskId, run.deadline);
    await persistGeneratedUrls(run, attempt.id, urls);
  } catch (error) {
    if (!(error instanceof ImageGenerationError) || error.retryable) throw error;
    await markAttemptFailed(run.database, attempt.id, error.code);
  }
}

/**
 * 发起一次供应商调用并把结果归类。
 * 已提交（异步任务已拿到 taskId）后的非终局错误一律抛出，交给任务重试后走 `resumeWaitingAttempt`。
 */
async function runAttempt(run: ThemeRun, model: ActiveAiModel, adapter: ImageModelAdapter, request: Omit<ImageEditRequest, 'onSubmitted' | 'onProviderRequest'>): Promise<AttemptOutcome> {
  const { database, jobId, lease, log } = run;
  await refreshGeneration(database, { kind: 'theme', id: run.jobId }, lease, 'provider_submitting');
  const attemptId = randomUUID();
  await transaction(database, async client => {
    await lockRunningLease(client, { kind: 'theme', id: run.jobId }, lease);
    await client.query(`INSERT INTO theme_job_provider_attempts(id, job_id, provider, model, revision, status, model_id)
      VALUES($1, $2, $3, $4, $5, 'submitting', $6)`, [attemptId, jobId, model.protocol, model.model, model.revision, model.id]);
  });
  let submitted = false;
  let providerRequestId: string | undefined;
  try {
    const urls = await adapter.edit(model, { ...request, onSubmitted: async taskId => {
      submitted = true;
      await database.query("UPDATE theme_job_provider_attempts SET status = 'waiting', provider_task_id = $2, updated_at = now() WHERE id = $1", [attemptId, taskId]);
    }, onProviderRequest: async id => {
      providerRequestId = id;
      await database.query('UPDATE theme_job_provider_attempts SET provider_request_id = $2 WHERE id = $1', [attemptId, id]);
    } });
    return { kind: 'generated', attemptId, providerRequestId, urls };
  } catch (error) {
    if (submitted) {
      if (error instanceof ImageGenerationError && !error.retryable && !error.outcomeUnknown && error.code === 'PROVIDER_GENERATION_FAILED') {
        await markAttemptFailed(database, attemptId, error.code);
        return { kind: 'halt' };
      }
      throw error;
    }
    const classified = error instanceof ImageGenerationError ? error : new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
    await database.query('UPDATE theme_job_provider_attempts SET status = $2, reason = $3, updated_at = now() WHERE id = $1',
      [attemptId, classified.outcomeUnknown ? 'unknown' : 'failed', classified.code]);
    log.warn({ attemptId, modelId: model.id, protocol: model.protocol, providerRequestId, code: classified.code }, 'Theme provider attempt failed');
    return { kind: 'failed', error: classified };
  }
}

/**
 * 按模型顺序（快照任务只用冻结的模型）逐个尝试，每个模型最多 `MAX_ATTEMPTS_PER_MODEL` 次：
 * 可重试错误指数退避后重试；不可重试错误换下一个模型；结果不明或已有部分产出则停止，避免重复计费。
 */
async function submitWithFallback(run: ThemeRun, attempts: ProviderAttempt[], activeModels: ActiveAiModel[]) {
  const { database, job: themeJob, storage, deadline, log } = run;
  const models = themeJob.snapshot ? themeJob.snapshot.models.flatMap(pinned => {
    const model = activeModels.find(active => active.id === pinned.id && active.revision === pinned.revision);
    return model ? [model] : [];
  }) : activeModels;
  if (!models.length) return;
  const prompt = await resolveThemePrompt(database, themeJob);
  const source = await loadThemeSource(database, themeJob, storage);
  let collected = 0;
  for (const model of models) {
    const adapter = imageAdapter(model);
    const prior = attempts.filter(attempt => attempt.modelId === model.id && attempt.revision === model.revision).length;
    for (let index = prior; index < MAX_ATTEMPTS_PER_MODEL; index++) {
      // Resuming only supports jobs without output yet; once images arrive the job runs to completion so it never shrinks.
      if (collected === 0) throwIfDraining(run.draining);
      const count = Math.min(adapter.maxImagesPerRequest, themeJob.requestedCount - collected);
      const outcome = await runAttempt(run, model, adapter, { ...source, prompt, count, deadline });
      if (outcome.kind === 'halt') return;
      if (outcome.kind === 'failed') {
        const { error } = outcome;
        if (error.outcomeUnknown || collected > 0) return;
        if (!error.retryable) break;
        if (index < MAX_ATTEMPTS_PER_MODEL - 1) await delay(RETRY_BASE_DELAY_MS * 2 ** index);
        continue;
      }
      const { attemptId, providerRequestId, urls } = outcome;
      await persistGeneratedUrls(run, attemptId, urls);
      log.info({ attemptId, modelId: model.id, protocol: model.protocol, providerRequestId, images: urls.length }, 'Theme provider attempt completed');
      collected += urls.length;
      // Providers capped below the requested count are called again for the remainder; short answers end the job.
      if (urls.length && urls.length >= count && collected < themeJob.requestedCount) {
        index--;
        continue;
      }
      return;
    }
  }
}

/**
 * 主题生图阶段：先处理上一次执行遗留的供应商尝试（结果不明 / 等待中 / 已有产出），
 * 无遗留时才按模型回退策略发起新调用。产出的 URL 落到 `theme_job_generated_urls`，由结果阶段消费。
 */
export async function generateTheme(run: ThemeRun) {
  const { database, jobId, config } = run;
  const saved = await database.query<{ ordinal: number; url: string }>('SELECT ordinal, url FROM theme_job_generated_urls WHERE job_id = $1 ORDER BY ordinal', [jobId]);
  const attempts = await loadAttempts(database, jobId);
  const unresolved = attempts.find(attempt => attempt.status === 'waiting' || attempt.status === 'submitting' || attempt.status === 'unknown');
  if (unresolved?.status === 'submitting') {
    // 上次执行在提交途中中断，无法确认供应商是否已受理；标记为结果不明且不再重复提交。
    await database.query("UPDATE theme_job_provider_attempts SET status = 'unknown', reason = 'PROVIDER_OUTCOME_UNKNOWN', updated_at = now() WHERE id = $1", [unresolved.id]);
    return;
  }
  if (unresolved?.status === 'unknown') return;
  if (!unresolved && (saved.rows.length || attempts.some(attempt => attempt.status === 'succeeded'))) return;
  const activeModels = await activeAiModels(database, 'theme', config.aiModelEncryptionKey);
  if (unresolved?.status === 'waiting' && unresolved.taskId) {
    await resumeWaitingAttempt(run, { ...unresolved, taskId: unresolved.taskId }, activeModels);
    return;
  }
  await submitWithFallback(run, attempts, activeModels);
}
