import type { TypeProvider } from '../../type-provider.js';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import {
  getNotificationInboxDetail,
  listNotificationInbox,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../../modules/projects/notification-inbox.js';
import { uuid } from '../../../modules/projects/schema.js';
import { successResponse } from '../../schemas.js';

const tags = ['admin-project-notifications'];
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } as const;
const listQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    isRead: { type: 'boolean' },
    kind: { type: 'string', minLength: 1, maxLength: 50 },
    projectNo: { type: 'string', minLength: 1, maxLength: 50 },
  },
} as const;
const string = { type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const itemProperties = {
  id: string,
  eventId: string,
  kind: string,
  projectId: string,
  projectNo: string,
  sourceType: string,
  company: nullableString,
  contactName: nullableString,
  exhibitionName: nullableString,
  occurredAt: string,
  isRead: { type: 'boolean' },
  readAt: nullableString,
  delivery: { type: 'string', enum: ['pending', 'delivered', 'failed'] },
} as const;
const itemRequired = Object.keys(itemProperties) as (keyof typeof itemProperties)[];
const itemSchema = { type: 'object', additionalProperties: false, required: itemRequired, properties: itemProperties } as const;
const listSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'total', 'unreadCount', 'page', 'pageSize'],
  properties: {
    items: { type: 'array', items: itemSchema },
    total: { type: 'integer' },
    unreadCount: { type: 'integer' },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
  },
} as const;
const detailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...itemRequired, 'payload', 'status', 'schemeCode', 'assigneeName', 'deliveredAt', 'failedAt', 'attempts', 'lastErrorCode'],
  properties: {
    ...itemProperties,
    payload: { description: '事件载荷，结构随 kind 变化' },
    status: string,
    schemeCode: nullableString,
    assigneeName: nullableString,
    deliveredAt: nullableString,
    failedAt: nullableString,
    attempts: { type: 'integer' },
    lastErrorCode: nullableString,
  },
} as const;

export async function registerAdminProjectNotificationRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  await app.register(async plugin => {
    const routes = plugin.withTypeProvider<TypeProvider>();
    routes.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      adminUserId(request);
    });
    routes.get(
      '/project-notifications',
      {
        config: { permissions: ['notifications.read'] },
        schema: { tags, querystring: listQuery, response: { 200: successResponse(listSchema) } },
      },
      async request => ({ code: 0, data: await listNotificationInbox(pool, adminUserId(request), request.query) }) as const,
    );
    routes.post(
      '/project-notifications/read-all',
      {
        config: { permissions: ['notifications.mark-all-read'] },
        schema: {
          tags,
          response: {
            200: successResponse({
              type: 'object',
              additionalProperties: false,
              required: ['updated'],
              properties: { updated: { type: 'integer' } },
            }),
          },
        },
      },
      async request => ({ code: 0, data: { updated: await markAllNotificationsRead(pool, adminUserId(request)) } }) as const,
    );
    routes.get(
      '/project-notifications/:id',
      {
        config: { permissions: ['notifications.read'] },
        schema: { tags, params: idParams, response: { 200: successResponse(detailSchema) } },
      },
      async request => ({ code: 0, data: await getNotificationInboxDetail(pool, adminUserId(request), request.params.id) }) as const,
    );
    routes.post(
      '/project-notifications/:id/read',
      {
        config: { permissions: ['notifications.mark-read'] },
        schema: {
          tags,
          params: idParams,
          response: {
            200: successResponse({
              type: 'object',
              additionalProperties: false,
              required: ['id', 'isRead'],
              properties: { id: { type: 'string' }, isRead: { type: 'boolean', const: true } },
            }),
          },
        },
      },
      async request => {
        await markNotificationRead(pool, adminUserId(request), request.params.id);
        return { code: 0, data: { id: request.params.id, isRead: true } } as const;
      },
    );
  });
}
