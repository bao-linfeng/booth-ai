import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from './config.js';
import { createStorage } from './infra/storage.js';
import { registerAdminModule } from './http/admin/index.js';
import { registerClientModule } from './http/client/index.js';
import { defaultUploadMaxBytes } from './http/uploads.js';
import { registerErrorContract } from './http/errors.js';

export interface HealthDependencies {
  database: () => Promise<unknown>;
  redis: () => Promise<unknown>;
  storage: () => Promise<unknown>;
}

export interface AuthDependencies {
  pool: pg.Pool;
  redis: Redis;
  storage: ReturnType<typeof createStorage>;
}

// 与 proxy-addr 的数字语义一致：信任离服务最近的 n 跳代理
function trustHops(hops: number) {
  return (_address: string, hop: number) => hop < hops;
}

export async function buildApp(config: Config, dependencies: HealthDependencies, authDependencies?: AuthDependencies) {
  const app = Fastify({
    logger: { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] },
    // Do not log URL query strings: future presigned URLs / SSO tickets may be secrets.
    disableRequestLogging: true,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    requestTimeout: 30000,
    ajv: { customOptions: { removeAdditional: false } },
    trustProxy: typeof config.trustProxy === 'number' ? trustHops(config.trustProxy) : config.trustProxy,
  });
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(helmet);
  await app.register(multipart, { limits: { fileSize: defaultUploadMaxBytes } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Booth AI API', version: '0.1.0', description: '服务端基础设施接口；业务与既有账户接口待后续接入。' },
      tags: [{ name: 'health', description: '存活与依赖就绪检查' }],
    },
  });
  app.addHook('onRequest', async (_request, reply) => { reply.header('x-request-id', _request.id); });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ method: request.method, route: request.routeOptions.url, statusCode: reply.statusCode, responseTime: reply.elapsedTime }, 'request completed');
  });
  registerErrorContract(app);

  app.get('/health/live', {
    schema: { tags: ['health'], summary: '进程存活', response: { 200: { type: 'object', required: ['status'], properties: { status: { type: 'string', const: 'ok' } } } } },
  }, async () => ({ status: 'ok' }));

  const readinessSchema = {
    type: 'object', required: ['status', 'checks'], properties: {
      status: { type: 'string', enum: ['ok', 'degraded'] },
      checks: { type: 'object', required: ['database', 'redis', 'storage'], properties: Object.fromEntries(['database', 'redis', 'storage'].map(name => [name, { type: 'string', enum: ['ok', 'error'] }])) },
    },
  };
  app.get('/health/ready', {
    schema: { tags: ['health'], summary: '数据库、队列依赖和存储桶就绪', response: { 200: readinessSchema, 503: readinessSchema } },
  }, async (_request, reply) => {
    const names = ['database', 'redis', 'storage'] as const;
    const results = await Promise.allSettled(names.map(name => boundedCheck(dependencies[name])));
    const checks = Object.fromEntries(names.map((name, index) => [name, results[index]?.status === 'fulfilled' ? 'ok' : 'error']));
    const ok = results.every(result => result.status === 'fulfilled');
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', checks });
  });

  if (authDependencies) {
    await registerClientModule(app, config, authDependencies.pool, authDependencies.redis, authDependencies.storage);
    await registerAdminModule(app, config, authDependencies.pool, authDependencies.redis, authDependencies.storage);
  }

  if (config.nodeEnv !== 'production') {
    await app.register(swaggerUi, { routePrefix: '/docs' });
    app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  }
  return app;
}

async function boundedCheck(check: () => Promise<unknown>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Dependency timeout')), 2500); }),
    ]);
  } finally { clearTimeout(timer); }
}
