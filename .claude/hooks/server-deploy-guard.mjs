// 确保 apps/server 改动后已重新部署 dev Docker 栈。
//   node server-deploy-guard.mjs mark  — PostToolUse(Bash)：执行 `compose ... up ... --build` 后记录当前指纹
//   node server-deploy-guard.mjs stop  — Stop：指纹与上次部署不一致时阻止结束并提醒部署
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MARKER = join(ROOT, '.claude', '.server-deploy-fingerprint');
const PATHS = ['apps/server', 'infra/compose.dev.yaml'];

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });

function fingerprint() {
  const hash = createHash('sha256');
  for (const path of PATHS) {
    hash.update(git('rev-parse', `HEAD:${path}`));
  }
  hash.update(git('diff', 'HEAD', '--binary', '--', ...PATHS));
  const untracked = git('ls-files', '-o', '--exclude-standard', '-z', '--', ...PATHS).toString('utf8').split('\0').filter(Boolean);
  for (const file of untracked.sort()) {
    hash.update(file);
    hash.update(readFileSync(join(ROOT, file)));
  }
  return hash.digest('hex');
}

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

const mode = process.argv[2];
const input = readInput();

try {
  if (mode === 'mark') {
    const command = String(input.tool_input?.command ?? '');
    if (/compose\b[\s\S]*\bup\b[\s\S]*--build/.test(command) && !input.tool_response?.interrupted) {
      writeFileSync(MARKER, fingerprint());
    }
  } else if (mode === 'stop') {
    const current = fingerprint();
    if (!existsSync(MARKER)) {
      writeFileSync(MARKER, current);
    } else if (!input.stop_hook_active && readFileSync(MARKER, 'utf8').trim() !== current) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: 'apps/server 或 infra/compose.dev.yaml 自上次部署后有改动，尚未重新部署 dev 栈。请执行 '
          + '`docker compose --env-file .env -f infra/compose.dev.yaml up -d --build`，'
          + '然后验证 schema_migrations 最新版本、`curl localhost:3000/health/ready`、worker 状态与日志，并汇报结果。'
          + '若本次改动确实无需部署（如仅改测试/文档），说明原因后即可结束。',
      }));
    }
  }
} catch (error) {
  process.stderr.write(`server-deploy-guard: ${error instanceof Error ? error.message : String(error)}\n`);
}
