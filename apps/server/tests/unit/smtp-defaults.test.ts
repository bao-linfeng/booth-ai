import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withSmtpDefaults } from '../../src/infra/smtp-defaults.js';

test('packaging keeps only SMTP settings and runtime environment overrides bundled values', t => {
  const directory = mkdtempSync(join(tmpdir(), 'booth-smtp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, '.env');
  const target = join(directory, 'smtp-defaults.json');
  writeFileSync(
    source,
    [
      'SMTP_HOST=smtp.example.test',
      'SMTP_PORT=465',
      'SMTP_SECURE=',
      'SMTP_USER=mailer',
      'SMTP_PASSWORD="pass$word#with=quotes"',
      'SMTP_FROM="灵通展台 <mailer@example.test>"',
      'CLIENT_PUBLIC_URL=http://localhost:5173',
      'DATABASE_URL=postgres://private',
      'SESSION_SECRET=private-session-secret',
    ].join('\n'),
  );
  execFileSync(process.execPath, ['--import', 'tsx', 'src/scripts/package-smtp.ts', source, target]);
  const defaults = JSON.parse(readFileSync(target, 'utf8'));
  assert.deepEqual(defaults, {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_SECURE: '',
    SMTP_USER: 'mailer',
    SMTP_PASSWORD: 'pass$word#with=quotes',
    SMTP_FROM: '灵通展台 <mailer@example.test>',
  });
  const env = { SMTP_HOST: 'override.example.test', CLIENT_PUBLIC_URL: 'https://booth.example.test' };
  assert.deepEqual(withSmtpDefaults(env, target), { ...defaults, ...env });
  assert.equal(withSmtpDefaults({ SMTP_HOST: '' }, target).SMTP_HOST, '', 'an explicit empty host disables bundled SMTP');
  assert.deepEqual(env, { SMTP_HOST: 'override.example.test', CLIENT_PUBLIC_URL: 'https://booth.example.test' });

  writeFileSync(source, 'SMTP_HOST=smtp.changed.test\nSMTP_FROM=mailer@example.test');
  execFileSync(process.execPath, ['--import', 'tsx', 'src/scripts/package-smtp.ts', source, target]);
  assert.equal(withSmtpDefaults({}, target).SMTP_HOST, 'smtp.changed.test', 'repackaging reads changed local settings');
});

test('images without bundled SMTP keep runtime configuration and invalid bundles never disclose credentials', t => {
  const directory = mkdtempSync(join(tmpdir(), 'booth-smtp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = join(directory, 'smtp-defaults.json');
  assert.deepEqual(withSmtpDefaults({ SMTP_HOST: 'runtime.example.test' }, target), { SMTP_HOST: 'runtime.example.test' });
  execFileSync(process.execPath, ['--import', 'tsx', 'src/scripts/package-smtp.ts', join(directory, 'missing'), target]);
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), {});
  for (const content of ['sensitive-invalid-value', '{"SMTP_PASSWORD":123}', '[]']) {
    writeFileSync(target, content);
    assert.throws(() => withSmtpDefaults({}, target), { message: 'Invalid packaged SMTP configuration' });
  }
  writeFileSync(target, JSON.stringify({ SMTP_HOST: 'smtp.example.test', DATABASE_URL: 'postgres://private' }));
  assert.deepEqual(withSmtpDefaults({}, target), { SMTP_HOST: 'smtp.example.test' });
});

test('existing environment without required SMTP fields fails with only the field name', t => {
  const directory = mkdtempSync(join(tmpdir(), 'booth-smtp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, '.env');
  const target = join(directory, 'smtp-defaults.json');
  writeFileSync(source, 'SMTP_PASSWORD=local-secret\nSMTP_USER=mailer');

  let caught: unknown;
  try {
    execFileSync(process.execPath, ['--import', 'tsx', 'src/scripts/package-smtp.ts', source, target], { stdio: 'pipe' });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error);
  const stderr = String((caught as Error & { stderr?: Buffer }).stderr ?? '');
  assert.match(stderr, /Missing environment variable: SMTP_HOST/);
  assert.doesNotMatch(stderr, /local-secret/);
});
