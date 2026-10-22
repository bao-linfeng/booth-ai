import { isDeepStrictEqual } from 'node:util';
import type { FastifyInstance } from 'fastify';

/**
 * 比对 JSON 响应序列化前后的内容：response schema 未声明的字段会被 Fastify 丢弃、类型不符会被强制转换，这里把这类契约漂移暴露出来。
 * - throw（test）：抛错，路由测试失败。
 * - log（development）：记录错误日志，响应照常。
 * - repair（production）：直接重新序列化序列化前的原始对象，schema 写漏时不让客户端丢数据；跳过 diff 计算，避免每次响应都做深比较。
 * 只比较对象响应，文件流、Buffer 与字符串原样跳过。
 */
export type ResponseGuardMode = 'throw' | 'log' | 'repair';

export function registerResponseGuard(app: FastifyInstance, mode: ResponseGuardMode) {
  const before = new WeakMap<object, unknown>();
  app.addHook('preSerialization', async (request, _reply, payload) => {
    if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) before.set(request, JSON.parse(JSON.stringify(payload)));
    return payload;
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (!before.has(request) || typeof payload !== 'string') return payload;
    const expected = before.get(request);
    before.delete(request);
    // In repair mode the guard's sole job is to not drop data when the schema is missing fields;
    // skip the expensive parse + deep-compare and just re-serialise from the pre-serialization snapshot.
    if (mode === 'repair') return JSON.stringify(expected);
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
