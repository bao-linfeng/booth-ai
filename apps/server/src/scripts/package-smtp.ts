import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { selectSmtpSettings } from '../infra/smtp-defaults.js';

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('SMTP packaging requires source and target paths');
const smtp: NodeJS.ProcessEnv = existsSync(source) ? selectSmtpSettings(parseEnv(readFileSync(source, 'utf8'))) : {};
if (existsSync(source)) {
  for (const key of ['SMTP_HOST', 'SMTP_FROM', ...(smtp.SMTP_USER?.trim() ? ['SMTP_PASSWORD'] : [])]) {
    if (!smtp[key]?.trim()) throw new Error(`Missing environment variable: ${key}`);
  }
}
writeFileSync(target, JSON.stringify(smtp), { mode: 0o600 });
console.info(smtp.SMTP_HOST ? 'Local SMTP configuration packaged' : 'No SMTP configuration packaged');
