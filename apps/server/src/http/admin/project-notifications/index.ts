import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { adminUserId } from '../../authentication.js';
import { getNotificationInboxDetail, listNotificationInbox, markAllNotificationsRead, markNotificationRead, type NotificationInboxQuery } from '../../../modules/projects/notification-inbox.js';
import { uuid } from '../../../modules/projects/schema.js';

const tags = ['admin-project-notifications'];
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } };
const listQuery = {
  type: 'object', additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 }, isRead: { type: 'boolean' },
    kind: { type: 'string', minLength: 1, maxLength: 50 }, projectNo: { type: 'string', minLength: 1, maxLength: 50 },
  },
};

export async function registerAdminProjectNotificationRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  await app.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => { reply.header('Cache-Control', 'private, no-store'); adminUserId(request); });
    routes.get<{ Querystring: NotificationInboxQuery }>('/project-notifications', { schema: { tags, querystring: listQuery } },
      async request => ({ code: 0, data: await listNotificationInbox(pool, adminUserId(request), request.query) }));
    routes.post('/project-notifications/read-all', { schema: { tags } },
      async request => ({ code: 0, data: { updated: await markAllNotificationsRead(pool, adminUserId(request)) } }));
    routes.get<{ Params: { id: string } }>('/project-notifications/:id', { schema: { tags, params: idParams } },
      async request => ({ code: 0, data: await getNotificationInboxDetail(pool, adminUserId(request), request.params.id) }));
    routes.post<{ Params: { id: string } }>('/project-notifications/:id/read', { schema: { tags, params: idParams } },
      async request => { await markNotificationRead(pool, adminUserId(request), request.params.id); return { code: 0, data: { id: request.params.id, isRead: true } }; });
  });
}
