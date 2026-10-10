import pg from 'pg';
import type { Config } from '../config.js';
import { logger } from './logger.js';

export function createDatabase(config: Config) {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  });
  // A dropped idle connection must not terminate the process or print connection details.
  pool.on('error', () => logger.error('PostgreSQL idle connection error'));
  return pool;
}

export async function transaction<T>(pool: pg.Pool, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
