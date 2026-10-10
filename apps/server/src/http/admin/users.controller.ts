import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAdmin, getUser, listAdmins, listUsers, type ListAccountsOptions } from '../../modules/identity/accounts.js';

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
};

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1 } },
};

export async function registerAdminUserRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get('/users', { config: { permissions: ['users.read'] },
    schema: {
      tags: ['admin-users'],
      querystring: {
        ...paginationSchema,
        properties: { ...paginationSchema.properties, phone: { type: 'string', minLength: 1 } },
      },
    },
  }, async request => {
    const result = await listUsers(pool, toListOptions(request.query as ListQuery, true));
    return { code: 0, data: result };
  });

  app.get('/users/:id', { config: { permissions: ['users.detail'] },
    schema: { tags: ['admin-users'], params: idParamsSchema },
  }, async request => {
    const result = await getUser(pool, (request.params as { id: string }).id);
    return { code: 0, data: result };
  });

  app.get('/admins', { config: { permissions: ['admins.read'] },
    schema: { tags: ['admin-users'], querystring: paginationSchema },
  }, async request => {
    const result = await listAdmins(pool, toListOptions(request.query as ListQuery, false));
    return { code: 0, data: result };
  });

  app.get('/admins/:id', { config: { permissions: ['admins.read'] },
    schema: { tags: ['admin-users'], params: idParamsSchema },
  }, async request => {
    const result = await getAdmin(pool, (request.params as { id: string }).id);
    return { code: 0, data: result };
  });
}
