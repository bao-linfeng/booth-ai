import { writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DelayedError, Worker, type Job, type Processor } from 'bullmq';
import { loadConfig } from './config.js';
import { createDatabase } from './infra/database.js';
import { createRedis, waitForRedis } from './infra/redis.js';
import { createStorage } from './infra/storage.js';
import { configureLogger, errorCode, logger } from './infra/logger.js';
import { createWebhookSender } from './infra/webhook.js';
import { createQueue, QUEUE_NAME, TASK_NAME, THEME_QUEUE_NAME, THEME_TASK_NAME, ARTWORK_QUEUE_NAME, ARTWORK_TASK_NAME, CS_QUEUE_NAME, CS_TRANSLATE_TASK_NAME } from './infra/queue.js';
import { processEchoTask } from './modules/tasks/service.js';
import { dispatchOutbox } from './workers/outbox.js';
import { settleThemeJob, processThemeJob } from './modules/generation/theme/execution.js';
import { processArtworkJob, settleArtworkJob } from './modules/generation/artwork/execution.js';
import { dispatchGenerationOutbox } from './workers/generation-outbox.js';
import { GenerationInterruptedError } from './modules/generation/execution.js';
import { reconcileJobCredits } from './modules/generation/credit-reconciliation.js';
import { recoverGenerationJobs } from './workers/generation-recovery.js';
import { deliverProjectNotifications } from './workers/project-notifications.js';
import { deliverReceiptEmails } from './workers/receipt-emails.js';
import { createSmtpSender } from './infra/mailer.js';
import { createScheduler, type ScheduledTask } from './workers/scheduler.js';

// Slow external deliveries and hourly maintenance run in their own lane so they never hold up outbox dispatch,
// recovery or reconciliation in the default lane.
const BACKGROUND_LANE = 'background';
import { collectWorkerMetrics, createJobStats } from './workers/metrics.js';
import { CS_LOCALES, type CsLocale } from './modules/customer-service/domain.js';
import { failTranslation, translateMessage } from './modules/customer-service/translation.js';
import { dispatchCsTranslations } from './workers/cs-translation.js';
import { deliverCsEmails } from './workers/cs-emails.js';
import { runCsRetention, sweepCsAgents } from './workers/cs-maintenance.js';

// Liveness marker for the container healthcheck (mtime) and a JSON status report for diagnosis.
const heartbeatPath = '/tmp/worker-ready';
const statusPath = '/tmp/worker-status.json';
const log = logger.child({ process: 'worker' });
// Stays below the container stop_grace_period (180s in infra/compose.dev.yaml) so the process exits on its own after an
// in-flight provider call (a single Seedream image takes about a minute) instead of being killed mid-request.
const SHUTDOWN_TIMEOUT_MS = 170_000;
const STARTUP_GRACE_MS = 60_000;

async function main() {
  await rm(heartbeatPath, { force: true });
  const config = loadConfig();
  configureLogger(config.logLevel);
  const database = createDatabase(config);
  const consumerRedis = createRedis(config, 'worker');
  // Producer must fail promptly, otherwise an outage could hold a DB transaction forever.
  const producerRedis = createRedis(config, 'request');
  const storage = createStorage(config);
  await Promise.all([waitForRedis(consumerRedis), waitForRedis(producerRedis)]);

  const queue = createQueue(producerRedis);
  const themeQueue = createQueue(producerRedis, THEME_QUEUE_NAME, 2000);
  const artworkQueue = createQueue(producerRedis, ARTWORK_QUEUE_NAME, 2000);
  const csQueue = createQueue(producerRedis, CS_QUEUE_NAME, 2000);
  const jobStats = createJobStats();
  // Aborted on SIGTERM: generation jobs stop at their next checkpoint between provider calls.
  const draining = new AbortController();

  // Every consumer reports queue wait and run time with the job id that links API request logs to provider attempts.
  const observed = (queueName: string, processor: Processor): Processor => async (job: Job, token) => {
    const started = Date.now();
    const waitMs = Math.max(0, started - job.timestamp);
    const context = { queue: queueName, jobId: job.id, attempt: job.attemptsMade + 1 };
    try {
      const result = await processor(job, token);
      jobStats.record(queueName, 'completed', waitMs, Date.now() - started);
      log.info({ ...context, waitMs, runMs: Date.now() - started }, 'Queue job completed');
      return result;
    } catch (error) {
      if (error instanceof GenerationInterruptedError && token) {
        // Hand the job back without spending a retry; the next worker resumes it from the persisted state.
        await job.moveToDelayed(Date.now() + 1000, token);
        log.info({ ...context, waitMs, runMs: Date.now() - started }, 'Queue job interrupted by shutdown; resumes on the next worker');
        throw new DelayedError();
      }
      jobStats.record(queueName, 'failed', waitMs, Date.now() - started);
      log.warn({ ...context, waitMs, runMs: Date.now() - started, code: errorCode(error) }, 'Queue job failed');
      throw error;
    }
  };

  const worker = new Worker(QUEUE_NAME, observed(QUEUE_NAME, async job => {
    if (job.name !== TASK_NAME || typeof job.data.taskId !== 'string' || job.data.taskId !== job.id) throw new Error('Invalid foundation job');
    return processEchoTask(database, job.data.taskId);
  }), { connection: consumerRedis, concurrency: 4 });
  worker.on('error', () => log.error({ queue: QUEUE_NAME }, 'Worker connection error'));
  worker.on('failed', (job) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void database.query(`UPDATE foundation_tasks SET status = 'failed', error_code = 'PROCESSING_FAILED', updated_at = now() WHERE id = $1 AND status <> 'succeeded'`, [job.id])
      .catch(error => log.error({ queue: QUEUE_NAME, jobId: job.id, code: errorCode(error) }, 'Unable to persist failed task status'));
  });

  const publishThemeEvent = async (jobId: string, event: unknown) => {
    await producerRedis.publish(`theme-job:${jobId}`, JSON.stringify(event));
  };
  const themeWorker = new Worker(THEME_QUEUE_NAME, observed(THEME_QUEUE_NAME, async job => {
    if (job.name !== THEME_TASK_NAME || typeof job.data.jobId !== 'string' || job.data.jobId !== job.id) throw new Error('Invalid theme job');
    return processThemeJob(database, job.data.jobId, config, storage, publishThemeEvent, draining.signal);
  }), { connection: consumerRedis, concurrency: 2 });
  themeWorker.on('error', () => log.error({ queue: THEME_QUEUE_NAME }, 'Worker connection error'));
  themeWorker.on('failed', (job) => {
    if (!job?.id || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void settleThemeJob(database, job.id, undefined, publishThemeEvent)
      .catch(error => log.error({ queue: THEME_QUEUE_NAME, jobId: job.id, code: errorCode(error) }, 'Unable to settle failed theme job'));
  });

  const publishArtworkEvent = async (jobId: string, event: unknown) => {
    await producerRedis.publish(`artwork-job:${jobId}`, JSON.stringify(event));
  };
  const artworkWorker = new Worker(ARTWORK_QUEUE_NAME, observed(ARTWORK_QUEUE_NAME, async job => {
    if (job.name !== ARTWORK_TASK_NAME || typeof job.data.jobId !== 'string' || job.data.jobId !== job.id) throw new Error('Invalid artwork job');
    return processArtworkJob(database, job.data.jobId, config, storage, publishArtworkEvent, draining.signal);
  }), { connection: consumerRedis, concurrency: 2 });
  artworkWorker.on('error', () => log.error({ queue: ARTWORK_QUEUE_NAME }, 'Worker connection error'));
  artworkWorker.on('failed', (job) => {
    if (!job?.id || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void settleArtworkJob(database, job.id, undefined, publishArtworkEvent)
      .catch(error => log.error({ queue: ARTWORK_QUEUE_NAME, jobId: job.id, code: errorCode(error) }, 'Unable to settle failed artwork job'));
  });

  // 客服翻译：每次尝试按主备顺序调用全部模型，3 次都失败后标记 failed，前端显示原文
  const csTranslation = (data: unknown): { messageId: string; locale: CsLocale } | null => {
    const value = data as { messageId?: unknown; locale?: unknown } | null;
    return typeof value?.messageId === 'string' && CS_LOCALES.includes(value.locale as CsLocale) ? { messageId: value.messageId, locale: value.locale as CsLocale } : null;
  };
  const csWorker = new Worker(CS_QUEUE_NAME, observed(CS_QUEUE_NAME, async job => {
    const item = csTranslation(job.data);
    if (job.name !== CS_TRANSLATE_TASK_NAME || !item) throw new Error('Invalid customer service job');
    return translateMessage(database, config.aiModelEncryptionKey, producerRedis, item.messageId, item.locale);
  }), { connection: consumerRedis, concurrency: 4 });
  csWorker.on('error', () => log.error({ queue: CS_QUEUE_NAME }, 'Worker connection error'));
  csWorker.on('failed', (job, error) => {
    const item = csTranslation(job?.data);
    if (!job || !item || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void failTranslation(database, producerRedis, item.messageId, item.locale, errorCode(error))
      .catch(failure => log.error({ queue: CS_QUEUE_NAME, jobId: job.id, code: errorCode(failure) }, 'Unable to persist failed translation'));
  });

  await worker.waitUntilReady();
  await themeWorker.waitUntilReady();
  await artworkWorker.waitUntilReady();
  await csWorker.waitUntilReady();

  const generationQueues = { theme: themeQueue, artwork: artworkQueue };
  const tasks: ScheduledTask[] = [
    { name: 'foundation-outbox', intervalMs: 1000, staleAfterMs: 30_000, run: () => dispatchOutbox(database, queue) },
    { name: 'theme-outbox', intervalMs: 1000, staleAfterMs: 30_000, run: () => dispatchGenerationOutbox(database, 'theme', themeQueue, publishThemeEvent) },
    { name: 'artwork-outbox', intervalMs: 1000, staleAfterMs: 30_000, run: () => dispatchGenerationOutbox(database, 'artwork', artworkQueue, publishArtworkEvent) },
    { name: 'generation-recovery', intervalMs: 60_000, staleAfterMs: 300_000, run: async () => {
      const recovery = await recoverGenerationJobs(database, generationQueues, { theme: publishThemeEvent, artwork: publishArtworkEvent });
      if (recovery.enqueued || recovery.retried || recovery.settled || recovery.errors.length) log.warn({ recovery }, 'Generation recovery');
    } },
    { name: 'cs-translation-outbox', intervalMs: 1000, staleAfterMs: 30_000, run: () => dispatchCsTranslations(database, csQueue) },
    { name: 'cs-retention', intervalMs: 3_600_000, staleAfterMs: 7_200_000, lane: BACKGROUND_LANE, run: () => runCsRetention(database, log) },
    { name: 'cs-agent-sweep', intervalMs: 60_000, staleAfterMs: 300_000, run: () => sweepCsAgents(database, producerRedis, log) },
    // Unrepairable issues are persisted on the job rows and listed on the admin generation job page.
    { name: 'credit-reconciliation', intervalMs: 60_000, staleAfterMs: 300_000, run: async () => {
      const credits = await reconcileJobCredits(database);
      if (credits.repaired || credits.issues.length) log.warn({ credits }, 'Credit reconciliation');
    } },
  ];
  if (config.projectNotificationWebhook) {
    const send = createWebhookSender(config.projectNotificationWebhook);
    tasks.push({ name: 'project-notifications', intervalMs: 5000, staleAfterMs: 120_000, lane: BACKGROUND_LANE, run: () => deliverProjectNotifications(database, send, log) });
  } else {
    log.warn('Project notification channel not configured; events stay pending in project_notification_outbox');
  }
  if (config.receiptEmail) {
    const { smtp, clientPublicUrl } = config.receiptEmail;
    const send = createSmtpSender(smtp);
    tasks.push({ name: 'receipt-emails', intervalMs: 5000, staleAfterMs: 180_000, lane: BACKGROUND_LANE, run: () => deliverReceiptEmails(database, send, clientPublicUrl, log) });
    tasks.push({ name: 'cs-emails', intervalMs: 5000, staleAfterMs: 180_000, lane: BACKGROUND_LANE, run: () => deliverCsEmails(database, producerRedis, send, clientPublicUrl, log) });
  } else {
    log.warn('SMTP not configured; receipt and customer service emails stay pending in project_receipt_emails / cs_email_outbox');
  }
  // Metrics are diagnostics only and never decide worker health.
  let metrics: unknown = null;
  tasks.push({ name: 'metrics', intervalMs: 60_000, staleAfterMs: 300_000, critical: false, lane: BACKGROUND_LANE, run: async () => {
    metrics = { ...await collectWorkerMetrics(database, { foundation: queue, ...generationQueues, cs: csQueue }), jobs: jobStats.drain() };
    log.info({ metrics }, 'Worker metrics');
  } });
  const scheduler = createScheduler(tasks, log);

  let stopping = false;
  let lastHealthy: boolean | undefined;
  let healthFilesWritable = true;
  const controller = new AbortController();
  const startedAt = Date.now();
  const lanes = scheduler.run(controller.signal);
  // Health is evaluated on its own clock, so a lane stuck in a slow task cannot freeze the heartbeat of the others;
  // the stuck task itself turns the worker unhealthy once it exceeds its staleAfterMs.
  const healthLoop = (async () => {
    while (!stopping) {
      const report = scheduler.health({
        consumerRedis: consumerRedis.status === 'ready', producerRedis: producerRedis.status === 'ready',
        foundationWorker: worker.isRunning(), themeWorker: themeWorker.isRunning(), artworkWorker: artworkWorker.isRunning(), csWorker: csWorker.isRunning(),
      });
      // Right after start the first passes are still running; report "unhealthy" only once they had time to finish.
      const settled = lastHealthy !== undefined || report.healthy || Date.now() - startedAt > STARTUP_GRACE_MS;
      if (settled && report.healthy !== lastHealthy) {
        log[report.healthy ? 'info' : 'error']({ problems: report.problems }, report.healthy ? 'Worker healthy' : 'Worker unhealthy');
        lastHealthy = report.healthy;
      }
      try {
        await writeFile(statusPath, JSON.stringify({ ...report, metrics }));
        if (report.healthy) await writeFile(heartbeatPath, String(Date.now()));
        else await rm(heartbeatPath, { force: true });
        healthFilesWritable = true;
      } catch (error) {
        if (healthFilesWritable) log.error({ code: errorCode(error) }, 'Unable to write worker health files');
        healthFilesWritable = false;
      }
      await delay(1000, undefined, { signal: controller.signal }).catch(() => {});
    }
  })();
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    draining.abort();
    log.info('Worker draining; waiting for in-flight jobs to reach a checkpoint');
    const deadline = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    // Close every consumer at once so none keeps taking new jobs while another is still draining.
    const closing = Promise.all([worker.close(), themeWorker.close(), artworkWorker.close(), csWorker.close()]);
    await healthLoop;
    await rm(heartbeatPath, { force: true });
    await lanes;
    await closing;
    await queue.close();
    await themeQueue.close();
    await artworkQueue.close();
    await csQueue.close();
    consumerRedis.disconnect();
    producerRedis.disconnect();
    await database.end();
    storage.close();
    clearTimeout(deadline);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  log.info({ tasks: tasks.map(task => task.name), lanes: scheduler.lanes }, 'Worker ready; queue consumers and schedulers running');
}
main().catch(error => { log.fatal({ code: errorCode(error) }, 'Worker startup failed; check configuration and dependency health'); process.exit(1); });
