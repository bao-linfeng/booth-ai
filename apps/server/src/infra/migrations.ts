import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type pg from 'pg';

export const MIGRATION_PATTERN = /^\d+_.+\.sql$/;

export interface MigrationFile {
  version: string;
  checksum: string;
  sql: string;
}

export async function readMigrations(directory = resolve('migrations')): Promise<MigrationFile[]> {
  const versions = (await readdir(directory)).filter(name => MIGRATION_PATTERN.test(name)).sort();
  return Promise.all(
    versions.map(async version => {
      const sql = await readFile(resolve(directory, version), 'utf8');
      return { version, checksum: createHash('sha256').update(sql).digest('hex'), sql };
    }),
  );
}

// Readiness requires every bundled migration to be applied with the same checksum,
// so a process never serves traffic against a schema older than its code.
export function migrationReadiness(database: Pick<pg.Pool, 'query'>, expected: Pick<MigrationFile, 'version' | 'checksum'>[]) {
  if (!expected.length) throw new Error('No migrations bundled');
  return async () => {
    const { rows } = await database.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations WHERE version = ANY($1::text[])',
      [expected.map(migration => migration.version)],
    );
    const applied = new Map(rows.map(row => [row.version, row.checksum]));
    const missing = expected.filter(migration => applied.get(migration.version) !== migration.checksum);
    if (missing.length) throw new Error('Migration missing or checksum mismatch');
  };
}
