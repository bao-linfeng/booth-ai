import { writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'bullmq';
import { loadConfig } from './config.js';
import { createDatabase } from './infra/database.js';
import { createRedis, waitForRedis } from './infra/redis.js';
import { createQueue, QUEUE_NAME, TASK_NAME } from './infra/queue.js';
import { processEchoTask } from './modules/tasks/service.js';
import { dispatchOutbox } from './modules/tasks/outbox.js';

const heartbeatPath = '/tmp/worker-ready';
async function main() {
  await rm(heartbeatPath, { force: true });
  const config = loadConfig();
  const database = createDatabase(config);
  const consumerRedis = createRedis(config, 'worker');
  // Producer must fail promptly, otherwise an outage could hold a DB transaction forever.
  const producerRedis = createRedis(config, 'request');
  await Promise.all([waitForRedis(consumerRedis), waitForRedis(producerRedis)]);
  const queue = createQueue(producerRedis);
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
  await worker.waitUntilReady();
  let stopping = false;
  const controller = new AbortController();
  const loop = (async () => {
    while (!stopping) {
      try {
        await dispatchOutbox(database, queue);
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
    await queue.close();
    consumerRedis.disconnect();
    producerRedis.disconnect();
    await database.end();
    clearTimeout(deadline);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.info('Worker ready; foundation queue and outbox dispatcher running');
}
main().catch(() => { console.error('Worker startup failed; check configuration and dependency health'); process.exit(1); });
