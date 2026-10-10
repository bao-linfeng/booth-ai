import type { JsonSchemaToTsProvider } from '@fastify/type-provider-json-schema-to-ts';

/**
 * 路由统一使用的 Type Provider：请求与响应类型从 as const schema 推导。
 * 响应中 `format: 'date-time'` 的字段允许直接返回 Date（fast-json-stringify 会序列化为 ISO 字符串）；可空日期写成 anyOf [dateTime, null]。
 */
export type TypeProvider = JsonSchemaToTsProvider<{
  SerializerSchemaOptions: { deserialize: [{ pattern: { type: 'string'; format: 'date-time' }; output: Date | string }] };
}>;
