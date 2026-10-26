import { readFileSync } from 'node:fs';

const smtpKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const;

export function selectSmtpSettings(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(smtpKeys.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
}

export function withSmtpDefaults(
  env: NodeJS.ProcessEnv,
  file: string | URL = new URL('../../smtp-defaults.json', import.meta.url),
): NodeJS.ProcessEnv {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return env;
    throw new Error('Unable to read packaged SMTP configuration');
  }
  let defaults: NodeJS.ProcessEnv;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    defaults = selectSmtpSettings(parsed as NodeJS.ProcessEnv);
    if (Object.values(defaults).some(value => typeof value !== 'string')) throw new Error();
  } catch {
    throw new Error('Invalid packaged SMTP configuration');
  }
  return { ...defaults, ...env };
}
