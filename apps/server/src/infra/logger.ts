import { pino } from 'pino';

// Shared structured logger for non-HTTP processes and background modules.
// Only log identifiers and stable codes: error messages may embed upstream credentials or signed URLs.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'booth-server' },
  redact: ['authorization', 'cookie', 'apiKey', 'secret', '*.authorization', '*.apiKey', '*.secret'],
});

export type Logger = Pick<typeof logger, 'info' | 'warn' | 'error' | 'debug' | 'child'>;

export function configureLogger(level: string, process?: string) {
  logger.level = level;
  return process ? logger.child({ process }) : logger;
}

// Reduce an unknown failure to a stable, non-sensitive code (application codes, SQLSTATE, errno names).
export function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9][A-Z0-9_]{1,63}$/.test(error.code)
  )
    return error.code;
  return error instanceof Error ? error.name : 'UNKNOWN_ERROR';
}
