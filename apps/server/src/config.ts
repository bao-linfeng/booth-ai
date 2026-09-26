export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  redisUrl: string;
  corsOrigins: string[];
  sessionSecret: string;
  sessionTtlSeconds: number;
  externalApiUrl: string;
  s3: { endpoint: string; publicEndpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
}

// Validate names, never include supplied values (which may contain credentials).
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing environment variable: ${name}`);
    return value;
  };
  const url = (name: string, protocols: string[]): string => {
    const value = required(name);
    try {
      if (!protocols.includes(new URL(value).protocol)) throw new Error();
    } catch { throw new Error(`Invalid URL environment variable: ${name}`); }
    return value;
  };
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) throw new Error('Invalid LOG_LEVEL');
  const sessionSecret = required('SESSION_SECRET');
  if (Buffer.byteLength(sessionSecret, 'utf8') < 32) throw new Error('Invalid SESSION_SECRET');
  const sessionTtlSeconds = Number(env.SESSION_TTL_SECONDS ?? 86400);
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 1 || sessionTtlSeconds > 2592000) throw new Error('Invalid SESSION_TTL_SECONDS');
  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error();
    } catch { throw new Error('Invalid CORS_ORIGINS: explicit origins required'); }
  }
  return {
    nodeEnv: nodeEnv as Config['nodeEnv'], host: env.HOST ?? '0.0.0.0', port, logLevel,
    databaseUrl: url('DATABASE_URL', ['postgres:', 'postgresql:']),
    redisUrl: url('REDIS_URL', ['redis:', 'rediss:']), corsOrigins,
    sessionSecret, sessionTtlSeconds, externalApiUrl: url('EXTERNAL_API_URL', ['http:', 'https:']),
    s3: {
      endpoint: url('S3_ENDPOINT', ['http:', 'https:']),
      publicEndpoint: url('S3_PUBLIC_ENDPOINT', ['http:', 'https:']),
      region: env.S3_REGION ?? 'us-east-1', bucket: required('S3_BUCKET'),
      accessKeyId: required('S3_ACCESS_KEY'), secretAccessKey: required('S3_SECRET_KEY'),
    },
  };
}
