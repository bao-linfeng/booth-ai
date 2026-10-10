import { isDeepStrictEqual } from 'node:util';
import type { FastifyInstance } from 'fastify';

/**
 * 开发与测试环境下比对 JSON 响应序列化前后的内容：response schema 未声明的字段会被 Fastify 丢弃、类型不符会被强制转换，
 * 这里把这类契约漂移暴露出来。test 环境抛错让路由测试失败；development 只记录错误日志。生产环境不注册。
 * 只比较对象响应，文件流、Buffer 与字符串原样跳过。
 */
export function registerResponseGuard(app: FastifyInstance, mode: 'throw' | 'log') {
  const before = new WeakMap<object, unknown>();
  app.addHook('preSerialization', async (request, _reply, payload) => {
    if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) before.set(request, JSON.parse(JSON.stringify(payload)));
    return payload;
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (!before.has(request) || typeof payload !== 'string') return payload;
    const expected = before.get(request);
    before.delete(request);
    let actual: unknown;
    try {
      actual = JSON.parse(payload);
    } catch {
      return payload;
    }
    if (isDeepStrictEqual(actual, expected)) return payload;
    const route = `${request.method} ${request.routeOptions.url ?? request.url}`;
    const paths = differences(expected, actual).slice(0, 10);
    if (mode === 'throw')
      throw new Error(`Response schema changed the payload of ${route} (status ${reply.statusCode}): ${paths.join(', ')}`);
    request.log.error({ route, statusCode: reply.statusCode, paths }, 'Response schema changed the payload; declare the missing fields');
    return payload;
  });
}

function differences(expected: unknown, actual: unknown, path = '$'): string[] {
  if (isDeepStrictEqual(expected, actual)) return [];
  if (
    expected &&
    actual &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    Array.isArray(expected) === Array.isArray(actual)
  ) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].flatMap(key =>
      differences((expected as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key], `${path}.${key}`),
    );
  }
  return [path];
}
