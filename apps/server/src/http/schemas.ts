// 业务接口成功响应统一为 { code: 0, data }。声明 response schema 后 Fastify 按 schema 序列化，未声明的字段会被丢弃，
// 因此补 schema 时必须覆盖前端用到的全部字段；开发与测试环境的 response-guard 会在字段被丢弃或被强制转换时报错。
// 响应对象一律写 additionalProperties: false（序列化行为不变，推导出的类型才不带索引签名）。
// schema 用 `as const` 声明，路由经 `app.withTypeProvider<TypeProvider>()` 注册后，请求与响应类型都从 schema 推导。
export function successResponse<const D extends object>(data: D) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'data'],
    properties: { code: { type: 'integer', const: 0 }, message: { type: 'string' }, data },
  } as const;
}

const nullableString = { type: ['string', 'null'] } as const;

export const currentUserSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'externalUserId', 'accountType', 'username', 'enabled', 'roles', 'permissions', 'lastSyncedAt', 'loginSource'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    externalUserId: { type: 'string' },
    accountType: { type: 'string', enum: ['client', 'admin'] },
    type: { type: 'string', enum: ['client', 'su'] },
    username: { type: 'string' },
    nickname: nullableString,
    email: nullableString,
    mobile: nullableString,
    avatarPath: nullableString,
    company: nullableString,
    country: nullableString,
    city: nullableString,
    languageCode: nullableString,
    enabled: { type: 'boolean' },
    roles: { type: 'array', items: { type: 'string' } },
    permissions: { type: 'array', items: { type: 'string' } },
    lastSyncedAt: { type: 'string', format: 'date-time' },
    loginSource: { type: 'string', enum: ['password', 'sso_token'] },
  },
} as const;

export const adminCurrentUserSchema = {
  ...currentUserSchema,
  required: [...currentUserSchema.required, 'homePath'],
  properties: { ...currentUserSchema.properties, homePath: { type: 'string' } },
} as const;

export function sessionSchema<const U extends object>(user: U) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['accessToken', 'expiresAt', 'user'],
    properties: { accessToken: { type: 'string' }, expiresAt: { type: 'integer', description: '会话过期时间（Unix 秒）' }, user },
  } as const;
}

/** 只返回 { code: 0 } 的写操作（如登出） */
export const okResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['code'],
  properties: { code: { type: 'integer', const: 0 } },
} as const;

/** 管理端常用分页结构 { data, total, page, pageSize } */
export const pageSchema = <const T>(item: T) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: ['data', 'total', 'page', 'pageSize'],
    properties: {
      data: { type: 'array', items: item },
      total: { type: 'integer' },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
    },
  }) as const;

/** 删除等无返回数据的写操作：{ code: 0, data: null } */
export const nullDataResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'data'],
  properties: { code: { type: 'integer', const: 0 }, data: { type: 'null' } },
} as const;

/** 文件下载响应：二进制内容，不经 JSON 序列化 */
export const fileResponse = (contentType: string) =>
  ({ 200: { description: `文件内容（${contentType}）`, type: 'string', format: 'binary' } }) as const;
