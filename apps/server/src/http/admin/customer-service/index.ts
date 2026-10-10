import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { eligibleAgent, listAgents, requeueAgentConversations } from '../../../modules/customer-service/agents.js';
import {
  claimConversation,
  closeConversation,
  conversationCounts,
  getConversationDetail,
  listConversations,
  releaseConversation,
  transferConversation,
  type ConversationTab,
  type Viewer,
} from '../../../modules/customer-service/conversations.js';
import { AGENTS_CHANNEL, agentEventVisible } from '../../../modules/customer-service/events.js';
import { listAdminMessages, markAgentRead, postAgentMessage, type AgentMessageInput } from '../../../modules/customer-service/messages.js';
import { agentsOnline, removeAgent, setAway, touchAgent } from '../../../modules/customer-service/presence.js';
import { settingsView, updateSettings, type CsSettingsInput } from '../../../modules/customer-service/settings.js';
import { revalidatePrincipal, type Principal } from '../../../modules/identity/principal.js';
import { adminUserId, issueEventTicket, requirePrincipal } from '../../authentication.js';
import { streamEvents } from '../../sse.js';
import { hasAdminPermission, requireAdminPermission } from '../authorization.js';
import type { PermissionCode } from '../../../modules/identity/permissions.js';
import {
  actionSchema,
  agentsSchema,
  detailSchema,
  eventsSchema,
  getSettingsSchema,
  listSchema,
  messagesSchema,
  postMessageSchema,
  presenceSchema,
  putSettingsSchema,
  readSchema,
  ticketSchema,
  transferSchema,
} from './schema.js';

type ConversationParams = { conversationId: string };

function has(request: FastifyRequest, code: PermissionCode): boolean {
  try {
    requireAdminPermission(request, code);
    return true;
  } catch {
    return false;
  }
}

/**
 * 工作台流的事件过滤与心跳复核。心跳按建立时的令牌复核 Session 与最新权限：Session 失效或失去 read 时断流
 * （坐席在线状态随心跳过期，与断线一致）；坐席资格失效时移出在线并退回其会话；supervise 按最新权限收窄或放宽过滤范围。
 */
export function workbenchStream(pool: pg.Pool, redis: Redis, principal: Principal, agent: boolean) {
  const adminId = principal.localId;
  let supervise = hasAdminPermission(principal.permissions, 'customer-service.supervise');
  return {
    visible: (payload: string) => agentEventVisible(payload, adminId, supervise),
    heartbeat: async (): Promise<boolean> => {
      if (agent && !(await eligibleAgent(pool, adminId))) {
        await removeAgent(redis, adminId);
        await requeueAgentConversations(pool, redis, adminId);
        return false;
      }
      const current = await revalidatePrincipal(pool, redis, principal);
      if (!current || !hasAdminPermission(current.permissions, 'customer-service.read')) return false;
      supervise = hasAdminPermission(current.permissions, 'customer-service.supervise');
      if (agent) await touchAgent(redis, adminId);
      return true;
    },
  };
}

/** 路由声明的权限只检查权限码本身；这里再校验依赖（如 supervise 依赖 read + reply） */
function viewer(request: FastifyRequest, code?: PermissionCode): Viewer {
  if (code) requireAdminPermission(request, code);
  return { adminId: adminUserId(request), supervise: has(request, 'customer-service.supervise') };
}

// 在线客服管理端接口（开发计划 §6.3）
export async function registerAdminCustomerServiceRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  await app.register(
    async scope => {
      scope.get<{ Querystring: { tab: ConversationTab; page: number; pageSize: number; projectId?: string } }>(
        '/conversations',
        { config: { permissions: ['customer-service.read'] }, schema: listSchema },
        async request => {
          const current = viewer(request, 'customer-service.read');
          if (request.query.projectId) requireAdminPermission(request, 'projects.read');
          return { code: 0, data: await listConversations(pool, current, request.query) };
        },
      );

      scope.get<{ Params: ConversationParams }>(
        '/conversations/:conversationId',
        { config: { permissions: ['customer-service.read'] }, schema: detailSchema },
        async request => {
          return {
            code: 0,
            data: await getConversationDetail(pool, viewer(request, 'customer-service.read'), request.params.conversationId),
          };
        },
      );

      scope.get<{ Params: ConversationParams; Querystring: { before?: number; after?: number; limit: number } }>(
        '/conversations/:conversationId/messages',
        { config: { permissions: ['customer-service.read'] }, schema: messagesSchema },
        async request => {
          return {
            code: 0,
            data: await listAdminMessages(pool, viewer(request, 'customer-service.read'), request.params.conversationId, request.query),
          };
        },
      );

      scope.post<{ Params: ConversationParams }>(
        '/conversations/:conversationId/claim',
        { config: { permissions: ['customer-service.reply'] }, schema: actionSchema('抢接') },
        async request => {
          return {
            code: 0,
            data: await claimConversation(pool, redis, viewer(request, 'customer-service.reply'), request.params.conversationId),
          };
        },
      );

      scope.post<{ Params: ConversationParams }>(
        '/conversations/:conversationId/release',
        { config: { permissions: ['customer-service.reply'] }, schema: actionSchema('释放回队列（仅当前坐席）') },
        async request => {
          return {
            code: 0,
            data: await releaseConversation(pool, redis, viewer(request, 'customer-service.reply'), request.params.conversationId),
          };
        },
      );

      scope.get('/agents', { config: { permissions: ['customer-service.supervise'] }, schema: agentsSchema }, async request => {
        requireAdminPermission(request, 'customer-service.supervise');
        return { code: 0, data: await listAgents(pool, redis) };
      });

      scope.post<{ Params: ConversationParams; Body: { adminId?: string | null; reason: string } }>(
        '/conversations/:conversationId/transfer',
        { config: { permissions: ['customer-service.supervise'] }, schema: transferSchema },
        async request => {
          return {
            code: 0,
            data: await transferConversation(
              pool,
              redis,
              viewer(request, 'customer-service.supervise'),
              request.params.conversationId,
              request.body,
            ),
          };
        },
      );

      scope.post<{ Params: ConversationParams }>(
        '/conversations/:conversationId/close',
        { config: { permissions: ['customer-service.reply'] }, schema: actionSchema('结束会话') },
        async request => {
          return {
            code: 0,
            data: await closeConversation(pool, redis, viewer(request, 'customer-service.reply'), request.params.conversationId),
          };
        },
      );

      scope.post<{ Params: ConversationParams; Body: AgentMessageInput }>(
        '/conversations/:conversationId/messages',
        { config: { permissions: ['customer-service.reply'] }, schema: postMessageSchema },
        async (request, reply) => {
          const { created, message } = await postAgentMessage(
            pool,
            redis,
            viewer(request, 'customer-service.reply'),
            request.params.conversationId,
            request.body,
          );
          return reply.code(created ? 201 : 200).send({ code: 0, data: { message } });
        },
      );

      scope.post<{ Params: ConversationParams; Body: { seq: number } }>(
        '/conversations/:conversationId/read',
        { config: { permissions: ['customer-service.reply'] }, schema: readSchema },
        async request => {
          return {
            code: 0,
            data: await markAgentRead(
              pool,
              redis,
              viewer(request, 'customer-service.reply'),
              request.params.conversationId,
              request.body.seq,
            ),
          };
        },
      );

      scope.put<{ Body: { status: 'online' | 'away' } }>(
        '/presence',
        { config: { permissions: ['customer-service.reply'] }, schema: presenceSchema },
        async request => {
          const { adminId } = viewer(request, 'customer-service.reply');
          await setAway(redis, adminId, request.body.status === 'away');
          return { code: 0, data: { status: request.body.status, agentsOnline: await agentsOnline(redis) } };
        },
      );

      scope.post('/events-ticket', { config: { permissions: ['customer-service.read'] }, schema: ticketSchema }, async request => {
        const { adminId } = viewer(request, 'customer-service.read');
        return {
          code: 0,
          data: {
            ticket: await issueEventTicket(redis, 'cs-admin', {
              subject: 'workbench',
              userId: adminId,
              token: requirePrincipal(request, 'admin').token,
            }),
          },
        };
      });

      // 工作台流：只订阅 cs:agents；坐席连接存活且未设为离开时计入在线，心跳时复核登录状态、权限与坐席有效性
      scope.get<{ Querystring: { ticket: string } }>(
        '/events',
        {
          config: {
            permissions: ['customer-service.read'],
            authentication: 'events',
            eventTicketPrefix: 'cs-admin',
            eventTicketParam: null,
          },
          schema: eventsSchema,
        },
        async (request, reply) => {
          const { adminId } = viewer(request, 'customer-service.read');
          const agent = has(request, 'customer-service.reply') && (await eligibleAgent(pool, adminId));
          const stream = workbenchStream(pool, redis, requirePrincipal(request, 'admin'), agent);
          await streamEvents(redis, reply, {
            channels: [AGENTS_CHANNEL],
            filter: (_channel, payload) => (stream.visible(payload) ? payload : null),
            onOpen: async () => {
              if (agent) await touchAgent(redis, adminId);
            },
            replay: async () => [{ type: 'ready', counts: await conversationCounts(pool, adminId) }],
            onHeartbeat: stream.heartbeat,
          });
        },
      );

      scope.get('/settings', { config: { permissions: ['customer-service.read'] }, schema: getSettingsSchema }, async request => {
        requireAdminPermission(request, 'customer-service.read');
        return { code: 0, data: await settingsView(pool) };
      });

      scope.put<{ Body: CsSettingsInput }>(
        '/settings',
        { config: { permissions: ['customer-service.settings'] }, schema: putSettingsSchema },
        async request => {
          requireAdminPermission(request, 'customer-service.settings');
          return { code: 0, data: await updateSettings(pool, request.body, adminUserId(request)) };
        },
      );
    },
    { prefix: '/customer-service' },
  );
}
