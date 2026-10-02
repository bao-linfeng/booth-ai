import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { dispatchThemeOutbox } from '../../src/modules/tasks/theme-outbox.js';

const database = new pg.Pool({
  connectionString: process.env.THEME_TEST_DATABASE_URL,
  options: `-c search_path=${process.env.THEME_TEST_SCHEMA}`,
});
const redis = new Redis(process.env.THEME_TEST_REDIS_URL!, { maxRetriesPerRequest: 1 });
const queue = new Queue(process.env.THEME_TEST_QUEUE!, { connection: redis });
await dispatchThemeOutbox(database, {
  getJob: queue.getJob.bind(queue),
  add: async (...args: Parameters<Queue['add']>) => {
    if (process.env.THEME_TEST_CRASH_STAGE === 'after-add') await queue.add(...args);
    process.send?.('crash-boundary');
    return new Promise<never>(() => {});
  },
});
