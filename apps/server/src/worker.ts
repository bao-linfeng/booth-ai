import { writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker, Queue } from 'bullmq';
import { loadConfig } from './config.js';
import { createDatabase } from './infra/database.js';
import { createRedis, waitForRedis } from './infra/redis.js';
import { createStorage } from './infra/storage.js';
import { createQueue, QUEUE_NAME, TASK_NAME, THEME_QUEUE_NAME, THEME_TASK_NAME, ARTWORK_QUEUE_NAME, ARTWORK_TASK_NAME } from './infra/queue.js';
import { processEchoTask } from './modules/tasks/service.js';
import { dispatchOutbox } from './modules/tasks/outbox.js';
import { processThemeJob } from './modules/tasks/theme-worker.js';
import { dispatchThemeOutbox } from './modules/tasks/theme-outbox.js';
import { processArtworkJob, settleArtworkJob } from './modules/tasks/artwork-worker.js';
import { dispatchArtworkOutbox } from './modules/tasks/artwork-outbox.js';

const heartbeatPath = '/tmp/worker-ready';
async function main() {
  await rm(heartbeatPath, { force: true });
  const config = loadConfig();
  const database = createDatabase(config);
  const consumerRedis = createRedis(config, 'worker');
  // Producer must fail promptly, otherwise an outage could hold a DB transaction forever.
  const producerRedis = createRedis(config, 'request');
  const storage = createStorage(config);
  await Promise.all([waitForRedis(consumerRedis), waitForRedis(producerRedis)]);

  const queue = createQueue(producerRedis);
  const themeQueue = new Queue(THEME_QUEUE_NAME, {
    connection: producerRedis,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } },
  });
  themeQueue.on('error', () => console.error('Theme queue connection error'));
  const artworkQueue = new Queue(ARTWORK_QUEUE_NAME, {
    connection: producerRedis,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } },
  });
  artworkQueue.on('error', () => console.error('Artwork queue connection error'));

  const worker = new Worker(QUEUE_NAME, async job => {
    if (job.name !== TASK_NAME || typeof job.data.taskId !== 'string' || job.data.taskId !== job.id) throw new Error('Invalid foundation job');
    return processEchoTask(database, job.data.taskId);
  }, { connection: consumerRedis, concurrency: 4 });
  worker.on('error', () => console.error('Worker connection error'));
  worker.on('failed', (job) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void database.query(`UPDATE foundation_tasks SET status = 'failed', error_code = 'PROCESSING_FAILED', updated_at = now() WHERE id = $1 AND status <> 'succeeded'`, [job.id])
      .catch(() => console.error('Unable to persist failed task status'));
  });

  const themeWorker = new Worker(THEME_QUEUE_NAME, async job => {
    if (job.name !== THEME_TASK_NAME || typeof job.data.jobId !== 'string') throw new Error('Invalid theme job');
    return processThemeJob(database, job.data.jobId, config, storage, async (jobId, event) => {
      await producerRedis.publish(`theme-job:${jobId}`, JSON.stringify(event));
    });
  }, { connection: consumerRedis, concurrency: 2 });
  themeWorker.on('error', () => console.error('Theme worker connection error'));
  themeWorker.on('failed', (job) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void database.query(
      `UPDATE theme_jobs SET status = 'failed', phase = NULL, updated_at = now() WHERE id = $1 AND status NOT IN ('succeeded', 'partially_succeeded', 'failed')`,
      [job.data.jobId]
    ).catch(() => console.error('Unable to persist failed theme job status'));
  });

  const publishArtworkEvent = async (jobId: string, event: unknown) => {
    await producerRedis.publish(`artwork-job:${jobId}`, JSON.stringify(event));
  };
  const artworkWorker = new Worker(ARTWORK_QUEUE_NAME, async job => {
    if (job.name !== ARTWORK_TASK_NAME || typeof job.data.jobId !== 'string') throw new Error('Invalid artwork job');
    return processArtworkJob(database, job.data.jobId, config, storage, publishArtworkEvent);
  }, { connection: consumerRedis, concurrency: 2 });
  artworkWorker.on('error', () => console.error('Artwork worker connection error'));
  artworkWorker.on('failed', (job) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void settleArtworkJob(database, job.data.jobId, undefined, publishArtworkEvent).catch(() => console.error('Unable to settle failed artwork job'));
  });

  await worker.waitUntilReady();
  await themeWorker.waitUntilReady();
  await artworkWorker.waitUntilReady();

  let stopping = false;
  const controller = new AbortController();
  const loop = (async () => {
    while (!stopping) {
      try {
        await dispatchOutbox(database, queue);
        await dispatchThemeOutbox(database, themeQueue);
        await dispatchArtworkOutbox(database, artworkQueue, publishArtworkEvent);
        if (consumerRedis.status !== 'ready' || producerRedis.status !== 'ready' || !worker.isRunning()) throw new Error('Worker unavailable');
        await writeFile(heartbeatPath, String(Date.now()));
      } catch {
        await rm(heartbeatPath, { force: true });
        console.error('Outbox dispatch unavailable; pending events retained for retry');
      }
      await delay(1000, undefined, { signal: controller.signal }).catch(() => {});
    }
  })();
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    const deadline = setTimeout(() => process.exit(1), 25000).unref();
    await loop;
    await rm(heartbeatPath, { force: true });
    await worker.close();
    await themeWorker.close();
    await artworkWorker.close();
    await queue.close();
    await themeQueue.close();
    await artworkQueue.close();
    consumerRedis.disconnect();
    producerRedis.disconnect();
    await database.end();
    storage.close();
    clearTimeout(deadline);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.info('Worker ready; foundation queue, theme queue, artwork queue, and outbox dispatchers running');
}
main().catch(() => { console.error('Worker startup failed; check configuration and dependency health'); process.exit(1); });
