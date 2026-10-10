import { buildApp } from './app.js';
import { closeEventStreams } from './http/sse.js';
import { loadConfig } from './config.js';
import { createDatabase } from './infra/database.js';
import { createRedis } from './infra/redis.js';
import { createStorage } from './infra/storage.js';
import { configureLogger, errorCode, logger } from './infra/logger.js';
import { migrationReadiness, readMigrations } from './infra/migrations.js';

async function main() {
  const config = loadConfig();
  configureLogger(config.logLevel);
  const database = createDatabase(config);
  const redis = createRedis(config);
  const storage = createStorage(config);
  const app = await buildApp(
    config,
    {
      database: migrationReadiness(database, await readMigrations()),
      redis: () => redis.ping(),
      storage: () => storage.check(),
    },
    { pool: database, redis, storage },
  );
  app.addHook('onClose', async () => {
    closeEventStreams(redis);
    redis.disconnect();
    storage.close();
    await database.end();
  });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 25000).unref();
    try {
      await app.close();
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    throw error;
  }
}
main().catch(error => {
  logger.fatal({ process: 'api', code: errorCode(error) }, 'API startup failed; check configuration and dependency health');
  process.exit(1);
});
