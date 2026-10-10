// 业务接口成功响应统一为 { code: 0, data }。声明 response schema 后 Fastify 按 schema 序列化，未声明的字段会被丢弃，
// 因此补 schema 时必须覆盖前端用到的全部字段，并在路由测试里比对序列化结果。
export function successResponse(data: Record<string, unknown>) {
  return {
    type: 'object',
    required: ['code', 'data'],
    properties: { code: { type: 'integer', const: 0 }, message: { type: 'string' }, data },
  } as const;
}

const nullableString = { type: ['string', 'null'] } as const;

export const currentUserSchema = {
  type: 'object',
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

export function sessionSchema(user: Record<string, unknown>) {
  return {
    type: 'object',
    required: ['accessToken', 'expiresAt', 'user'],
    properties: { accessToken: { type: 'string' }, expiresAt: { type: 'integer', description: '会话过期时间（Unix 秒）' }, user },
  } as const;
}
