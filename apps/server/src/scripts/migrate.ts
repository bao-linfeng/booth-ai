import { loadConfig } from '../config.js';
import { createDatabase } from '../infra/database.js';
import { readMigrations } from '../infra/migrations.js';

const pool = createDatabase(loadConfig());
try {
  const client = await pool.connect();
  try {
    // Serialize migration runners; each migration and its checksum commit atomically.
    await client.query('SELECT pg_advisory_lock(19002401)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const { version, checksum, sql } of await readMigrations()) {
      const existing = await client.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE version = $1', [version]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error('Applied migration checksum mismatch');
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [version, checksum]);
        await client.query('COMMIT');
        console.info(`Applied migration ${version}`);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    console.info('Database migrations ready');
  } finally { await client.query('SELECT pg_advisory_unlock(19002401)').catch(() => {}); client.release(); }
} catch {
  console.error('Migration failed; verify database connectivity and immutable migration checksums');
  process.exitCode = 1;
} finally { await pool.end(); }
