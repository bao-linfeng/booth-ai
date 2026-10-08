import { readdir, readFile } from 'node:fs/promises';

import { Redis } from 'ioredis';
import pg from 'pg';

import { integrationVariables } from './integration-env.js';

// 标准检查（compose `check` 服务）在跑测试前调用：重建独立测试库并执行全部迁移，清空测试专用 Redis 库。
// 多数集成测试会在测试库中自建临时 schema；BOM、通知收件箱等直接使用 public，依赖这里的迁移结果。
// 只允许操作名称以 _test 结尾的数据库和非 0 号 Redis 库，避免误清开发数据。
const variables = await integrationVariables();
const databaseUrls = new Set<string>();
for (const name of variables) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing integration test variable: ${name}`);
  if (name.endsWith('_DATABASE_URL')) databaseUrls.add(value);
}
const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('Missing DATABASE_URL');

for (const url of databaseUrls) {
  const database = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(database)) throw new Error(`Integration test database must end with _test: ${database}`);
  if (database === new URL(adminUrl).pathname.slice(1)) throw new Error('Integration test database must differ from DATABASE_URL');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${database}`);
  } finally { await admin.end(); }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    for (const name of migrations) await client.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    console.info(`Integration database ${database} recreated with ${migrations.length} migrations`);
  } finally { await client.end(); }
}

const redisUrls = new Set<string>();
for (const name of variables) if (name.endsWith('_REDIS_URL')) redisUrls.add(process.env[name]!);
for (const redisUrl of redisUrls) {
  const db = Number(new URL(redisUrl).pathname.slice(1) || 0);
  if (!Number.isInteger(db) || db === 0) throw new Error('Integration test Redis URLs must select a dedicated non-zero Redis database');
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  try { await redis.flushdb(); } finally { redis.disconnect(); }
  console.info(`Integration Redis database ${db} flushed`);
}
