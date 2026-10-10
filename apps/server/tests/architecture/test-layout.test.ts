import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const categories = ['architecture', 'unit', 'http', 'integration'];

// npm test 收集 tests/**/*.test.ts；目录只表达测试类型。需要数据库或 Redis 的测试统一放 integration/，
// Docker check 会为它们注入变量并要求 skipped 0。
test('test files live in a category directory and integration tests are grouped together', async () => {
  const root = new URL('../', import.meta.url);
  const misplaced: string[] = [];
  for (const entry of await readdir(root, { recursive: true })) {
    const file = entry.replaceAll('\\', '/');
    if (!file.endsWith('.test.ts')) continue;
    const [category, name, ...rest] = file.split('/');
    if (!name || rest.length || !categories.includes(category!)) { misplaced.push(`${file}: expected tests/<${categories.join('|')}>/*.test.ts`); continue; }
    const needsServices = /process\.env\.(?:[A-Z_]+_TEST_(?:DATABASE|REDIS)_URL|REQUIRE_INTEGRATION_TESTS)/.test(await readFile(new URL(file, root), 'utf8'));
    if (needsServices !== (category === 'integration')) misplaced.push(`${file}: ${needsServices ? 'uses test database/Redis variables, move to integration/' : 'needs no services, move out of integration/'}`);
  }
  assert.deepEqual(misplaced, []);
});
