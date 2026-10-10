import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : Promise.resolve(entry.name.endsWith('.ts') ? [filename] : []);
  }));
  return files.flat();
}

function imports(source: ts.SourceFile): string[] {
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      result.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      result.push(node.arguments[0].text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      result.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

test('domain modules and infrastructure cannot depend on HTTP portals or worker scheduling', async () => {
  const violations: string[] = [];
  for (const filename of await sourceFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, filename).replaceAll('\\', '/');
    const layer = relative.split('/')[0];
    if (/^modules\/(client|admin|su)\//.test(relative)) violations.push(`${relative}: business directory organized by portal`);
    const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const specifier of imports(source)) {
      if (layer === 'modules' && specifier === 'fastify') violations.push(`${relative}: business module imports Fastify`);
      if (!specifier.startsWith('.')) continue;
      const target = path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier)).replaceAll('\\', '/');
      if (['modules', 'infra', 'workers'].includes(layer ?? '') && target.startsWith('http/')) {
        violations.push(`${relative} -> ${target}`);
      }
      if (layer === 'modules' && (target.startsWith('workers/') || target === 'worker.js')) violations.push(`${relative} -> ${target}`);
      if (layer === 'infra' && (target.startsWith('modules/') || target.startsWith('workers/') || target === 'worker.js')) violations.push(`${relative} -> ${target}`);
      if (/^http\/(client|admin|su)\//.test(relative) && /^http\/(client|admin|su)\//.test(target) && relative.split('/')[1] !== target.split('/')[1]) {
        violations.push(`${relative} -> ${target}`);
      }
      if (/^modules\/(client|admin|su)\//.test(target)) violations.push(`${relative} -> legacy portal ${target}`);
    }
  }
  assert.deepEqual(violations, []);
});

// 业务模块之间的依赖白名单。dependsOn 必须无环；其他模块只能导入 exposes 列出的文件（相对模块目录）。
// 新增跨模块依赖时先确认方向：被依赖的一方不应了解调用方，跨模块用例放到上层编排模块（如 client-sign-in、prompt-preview）。
const moduleRules: Record<string, { dependsOn: string[]; exposes: string[] }> = {
  'ai-models': { dependsOn: [], exposes: [] },
  assets: { dependsOn: ['schemes'], exposes: ['deliverables.ts'] },
  audit: { dependsOn: [], exposes: [] },
  'client-sign-in': { dependsOn: ['identity', 'projects', 'selection'], exposes: [] },
  credits: { dependsOn: [], exposes: ['service.ts', 'management-service.ts'] },
  'customer-service': { dependsOn: ['selection'], exposes: [] },
  dashboard: { dependsOn: ['projects'], exposes: [] },
  dictionaries: { dependsOn: [], exposes: ['service.ts', 'language.ts', 'sizes.ts'] },
  generation: { dependsOn: ['credits', 'prompts'], exposes: ['artwork/queries.ts', 'artwork/prompt.ts', 'theme/prompt.ts', 'theme/domain.ts'] },
  identity: { dependsOn: [], exposes: ['service.ts', 'client-service.ts', 'roles.ts'] },
  projects: { dependsOn: ['dictionaries', 'generation', 'identity', 'schemes', 'selection'], exposes: ['claims.ts', 'domain.ts'] },
  'prompt-preview': { dependsOn: ['generation', 'prompts', 'selection'], exposes: [] },
  prompts: { dependsOn: [], exposes: ['service.ts', 'template.ts'] },
  schemes: { dependsOn: ['dictionaries'], exposes: ['publication.ts', 'image-spec.ts', 'readiness.ts', 'bill-of-materials/repository.ts'] },
  selection: { dependsOn: ['assets', 'dictionaries', 'prompts'], exposes: ['domain.ts', 'match.ts', 'prompt.ts', 'repository.ts', 'messages/index.ts', 'analytics/recording.ts'] },
  tasks: { dependsOn: [], exposes: [] },
};

test('business modules depend on each other only through declared, acyclic edges and exposed files', async () => {
  const modulesRoot = path.join(sourceRoot, 'modules');
  const present = new Set<string>();
  const used = new Set<string>();
  const violations: string[] = [];
  for (const filename of await sourceFiles(modulesRoot)) {
    const relative = path.relative(modulesRoot, filename).replaceAll('\\', '/');
    const owner = relative.split('/')[0]!;
    present.add(owner);
    const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const specifier of imports(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = path.relative(modulesRoot, path.resolve(path.dirname(filename), specifier)).replaceAll('\\', '/');
      if (target.startsWith('..')) continue;
      const [dependency, ...rest] = target.split('/');
      if (!dependency || dependency === owner) continue;
      const file = rest.join('/').replace(/\.js$/, '.ts');
      used.add(`${owner} -> ${dependency}`);
      if (!moduleRules[owner]?.dependsOn.includes(dependency)) violations.push(`${relative}: undeclared dependency on ${dependency}`);
      if (!moduleRules[dependency]?.exposes.includes(file)) violations.push(`${relative}: ${dependency}/${file} is not exposed`);
    }
  }
  assert.deepEqual(violations, []);
  assert.deepEqual([...present].sort(), Object.keys(moduleRules).sort(), 'every business module must declare its rules');
  const declared = Object.entries(moduleRules).flatMap(([owner, rule]) => rule.dependsOn.map(dependency => `${owner} -> ${dependency}`));
  assert.deepEqual(declared.filter(edge => !used.has(edge)), [], 'remove dependencies that are no longer used');

  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (name: string, trail: string[]) => {
    if (done.has(name)) return;
    assert.ok(!visiting.has(name), `module dependency cycle: ${[...trail, name].join(' -> ')}`);
    visiting.add(name);
    for (const dependency of moduleRules[name]?.dependsOn ?? []) visit(dependency, [...trail, name]);
    visiting.delete(name);
    done.add(name);
  };
  for (const name of Object.keys(moduleRules)) visit(name, []);
});

// 关键表只允许归属模块写入；其他模块可以读（报表、快照），写入必须调用归属模块的能力。
const tableOwners: { tables: RegExp; writers: string[] }[] = [
  { tables: /^credit_(transactions|reservations)$/, writers: ['modules/credits/'] },
  { tables: /^(theme|artwork)_job(s|_[a-z_]+)$|^\$\{[a-z.]+\}_job(s|_[a-z_]+)$/, writers: ['modules/generation/', 'workers/generation-'] },
];

test('ledger and generation job tables are only written by their owning module', async () => {
  const violations: string[] = [];
  for (const filename of await sourceFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, filename).replaceAll('\\', '/');
    if (relative.startsWith('scripts/')) continue;
    const text = await readFile(filename, 'utf8');
    for (const match of text.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([\w${}.]+)/gi)) {
      const table = match[1]!;
      const owner = tableOwners.find(rule => rule.tables.test(table));
      if (owner && !owner.writers.some(prefix => relative.startsWith(prefix))) violations.push(`${relative}: writes ${table}`);
    }
  }
  assert.deepEqual(violations, []);
});

// Controller 保持薄：HTTP 层不直接执行 SQL 或开启事务，查询与写入都放进业务模块，便于 Worker 等其他入口复用同一规则。
test('HTTP portals delegate persistence to business modules', async () => {
  const violations: string[] = [];
  for (const filename of await sourceFiles(path.join(sourceRoot, 'http'))) {
    const relative = path.relative(sourceRoot, filename).replaceAll('\\', '/');
    const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    if (imports(source).some(specifier => specifier.endsWith('/infra/database.js'))) violations.push(`${relative}: imports infra/database`);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'query') {
        violations.push(`${relative}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: runs a query`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, []);
});
