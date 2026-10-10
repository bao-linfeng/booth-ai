import { readdir, readFile } from 'node:fs/promises';

/** 从测试源码收集 *_TEST_DATABASE_URL / *_TEST_REDIS_URL，新增集成测试变量时无需改这里 */
export async function integrationVariables(): Promise<string[]> {
  const names = new Set<string>();
  const directory = new URL('../', import.meta.url);
  for (const entry of await readdir(directory, { recursive: true })) {
    if (!entry.endsWith('.ts')) continue;
    for (const match of (await readFile(new URL(entry.replaceAll('\\', '/'), directory), 'utf8')).matchAll(
      /process\.env\.([A-Z_]+_TEST_(?:DATABASE|REDIS)_URL)/g,
    ))
      names.add(match[1]!);
  }
  return [...names].sort();
}
