import type { FastifyInstance } from 'fastify';
import type { TypeProvider } from '../../type-provider.js';
import type pg from 'pg';
import { getAdmin, getUser, listAdmins, listUsers, type ListAccountsOptions } from '../../../modules/identity/accounts.js';
import { pageSchema, successResponse } from '../../schemas.js';

interface ListQuery {
  page?: number;
  pageSize?: number;
  username?: string;
  email?: string;
  phone?: string;
}

function toListOptions(query: ListQuery, includePhone: boolean): ListAccountsOptions {
  const username = query.username?.trim();
  const email = query.email?.trim();
  const phone = query.phone?.trim();
  return {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    ...(username ? { username } : {}),
    ...(email ? { email } : {}),
    ...(includePhone && phone ? { phone } : {}),
  };
}

const paginationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    username: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 1 },
  },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

const nullableString = { type: ['string', 'null'] } as const;
const strings = { type: 'array', items: { type: 'string' } } as const;
const accountSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'externalUserId',
    'username',
    'nickname',
    'email',
    'mobile',
    'avatarPath',
    'company',
    'country',
    'city',
    'languageCode',
    'enabled',
    'roles',
    'permissions',
    'lastLoginAt',
    'lastSyncedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    type: { type: 'string', enum: ['client', 'su'], description: '仅参展商账户：client 普通参展商，su 经 SU 插件登录' },
    id: { type: 'string' },
    externalUserId: { type: 'string' },
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
    roles: strings,
    permissions: strings,
    lastLoginAt: nullableString,
    lastSyncedAt: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;
const accountResponse = { 200: successResponse(accountSchema) } as const;
const accountListResponse = { 200: successResponse(pageSchema(accountSchema)) } as const;

export async function registerAdminUserRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  const routes = app.withTypeProvider<TypeProvider>();
  routes.get(
    '/users',
    {
      config: { permissions: ['users.read'] },
      schema: {
        tags: ['admin-users'],
        querystring: {
          ...paginationSchema,
          properties: { ...paginationSchema.properties, phone: { type: 'string', minLength: 1 } },
        },
        response: accountListResponse,
      },
    },
    async request => {
      const result = await listUsers(pool, toListOptions(request.query, true));
      return { code: 0, data: result } as const;
    },
  );

  routes.get(
    '/users/:id',
    { config: { permissions: ['users.detail'] }, schema: { tags: ['admin-users'], params: idParamsSchema, response: accountResponse } },
    async request => {
      const result = await getUser(pool, request.params.id);
      return { code: 0, data: result } as const;
    },
  );

  routes.get(
    '/admins',
    {
      config: { permissions: ['admins.read'] },
      schema: { tags: ['admin-users'], querystring: paginationSchema, response: accountListResponse },
    },
    async request => {
      const result = await listAdmins(pool, toListOptions(request.query, false));
      return { code: 0, data: result } as const;
    },
  );

  routes.get(
    '/admins/:id',
    { config: { permissions: ['admins.read'] }, schema: { tags: ['admin-users'], params: idParamsSchema, response: accountResponse } },
    async request => {
      const result = await getAdmin(pool, request.params.id);
      return { code: 0, data: result } as const;
    },
  );
}
