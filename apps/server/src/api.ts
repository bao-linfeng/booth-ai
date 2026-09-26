import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './infra/database.js';
import { createRedis } from './infra/redis.js';
import { createStorage } from './infra/storage.js';

async function main() {
  const config = loadConfig();
  const database = createDatabase(config);
  const redis = createRedis(config);
  const storage = createStorage(config);
  const app = await buildApp(config, {
    database: () => database.query('SELECT 1 FROM schema_migrations WHERE version = $1', ['001_foundation.sql']).then(result => { if (result.rowCount !== 1) throw new Error('Migration missing'); }),
    redis: () => redis.ping(),
    storage: () => storage.check(),
  }, { pool: database, redis });
  app.addHook('onClose', async () => {
    redis.disconnect();
    storage.close();
    await database.end();
  });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 25000).unref();
    try { await app.close(); } finally { clearTimeout(deadline); }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try { await app.listen({ host: config.host, port: config.port }); }
  catch (error) { await app.close(); throw error; }
}
main().catch(() => { console.error('API startup failed; check configuration and dependency health'); process.exit(1); });
