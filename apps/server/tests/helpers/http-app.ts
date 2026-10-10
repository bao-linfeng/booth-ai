import Fastify, { type FastifyServerOptions } from 'fastify';
import { registerErrorContract } from '../../src/http/errors.js';
import { registerResponseGuard } from '../../src/http/response-guard.js';

/** 与 buildApp 一致的错误契约与响应守卫：路由测试里 response schema 丢字段或改类型会直接失败 */
export function contractApp(options: FastifyServerOptions = {}) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } }, ...options });
  registerErrorContract(app);
  registerResponseGuard(app, 'throw');
  return app;
}
