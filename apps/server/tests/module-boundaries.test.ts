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
