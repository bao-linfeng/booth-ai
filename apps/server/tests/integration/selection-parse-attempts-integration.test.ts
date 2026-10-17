import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { emptyRequirement, type Catalog } from '../../src/modules/selection/domain.js';
import type { ExtractionAttempt } from '../../src/modules/selection/llm.js';
import { getSearch } from '../../src/modules/selection/analytics/queries.js';
import { ensureAttempt, recordParse, recordSearch } from '../../src/modules/selection/analytics/recording.js';

const catalog: Catalog = {
  boothSpaces: [],
  openingCounts: [],
  productSystems: [],
  industries: [],
  budgetTiers: [],
  styles: [],
  zones: [],
  features: [],
};

test(
  'model attempts recorded with a parse are returned by the admin search detail',
  { skip: !process.env.SELECTION_TEST_DATABASE_URL },
  async t => {
    const schema = `selection_attempts_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new pg.Pool({ connectionString: process.env.SELECTION_TEST_DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: process.env.SELECTION_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    });
    const names = (await readdir(new URL('../../migrations/', import.meta.url))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    for (const name of names) await pool.query(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));

    const identity = { visitorId: 'visitor_attempts_integration', userId: null };
    const attemptId = await ensureAttempt(pool, undefined, identity);
    const result = {
      requirement: emptyRequirement(),
      degraded: true,
      fieldSources: {},
      overrides: [],
      clarifications: [],
      unhandledText: [],
      warnings: [],
      rulesVersion: 'rules',
      dictionaryVersion: 'dictionary',
    };
    const attempts: ExtractionAttempt[] = [
      { modelId: randomUUID(), model: 'primary', attempt: 1, durationMs: 1800, outcome: 'timeout' },
      { modelId: randomUUID(), model: 'backup', attempt: 1, durationMs: 420, outcome: 'invalid_evidence', field: 'styleIds' },
    ];
    const record = async (llmAttempts: ExtractionAttempt[] | null) => {
      const parseId = await recordParse(pool, {
        attemptId,
        identity,
        inputText: '简洁现代',
        formRequirement: emptyRequirement(),
        result: { ...result, parser: llmAttempts ? 'rules' : 'none' },
        durationMs: 2300,
        llmAttempts,
      });
      const searchId = await recordSearch(pool, {
        attemptId,
        parseId,
        identity,
        mode: 'filtered',
        inputText: '简洁现代',
        catalog,
        result: {
          status: 'no_match',
          requirement: emptyRequirement(),
          counts: { direct: 0, reference: 0, random: 0, total: 0 },
          reasons: [],
          diagnostics: { reviewedPublished: 0, ready: 0, exclusions: {} } as never,
          items: [],
          rulesVersion: 'rules',
          dictionaryVersion: 'dictionary',
        },
        degradedParse: true,
        durationMs: 10,
      });
      return (await getSearch(pool, searchId)) as { llmAttempts: unknown };
    };

    assert.deepEqual((await record(attempts)).llmAttempts, attempts);
    assert.equal((await record(null)).llmAttempts, null);
  },
);
