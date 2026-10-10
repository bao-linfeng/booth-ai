import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { loadConfig } from '../../src/config.js';
import { registerAdminModule } from '../../src/http/admin/index.js';

const config = loadConfig({
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:19000', S3_BUCKET: 'test', S3_ACCESS_KEY: 'test-only', S3_SECRET_KEY: 'test-only',
  CORS_ORIGINS: 'http://localhost:5173', SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes', AI_MODEL_ENCRYPTION_KEY: 'a'.repeat(64),
  EXTERNAL_API_URL: 'https://api.example.test',
});

export type RoutePolicy = { public: true } | { public: false; permissions: readonly string[] | undefined };

/** 注册全部管理端路由并读取各路由声明的权限，键为 "METHOD /api/v1/admin/..."（含自动生成的 HEAD）。 */
export async function adminRoutePolicies(): Promise<Map<string, RoutePolicy>> {
  const app = Fastify();
  await app.register(multipart);
  const policies = new Map<string, RoutePolicy>();
  app.addHook('onRoute', route => {
    const { authentication, permissions } = route.config ?? {};
    for (const method of [route.method].flat()) {
      policies.set(`${method} ${route.url}`, authentication === 'public' ? { public: true } : { public: false, permissions });
    }
  });
  await registerAdminModule(app, config, {} as never, {} as never, {} as never);
  await app.ready();
  await app.close();
  return policies;
}

/** 路由声明的权限；未注册或公开路由返回 undefined。 */
export async function routePermissions() {
  const policies = await adminRoutePolicies();
  return (method: string, url: string) => {
    const policy = policies.get(`${method} ${url}`);
    return policy && !policy.public ? policy.permissions : undefined;
  };
}
