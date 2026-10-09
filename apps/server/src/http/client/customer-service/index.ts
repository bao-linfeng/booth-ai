import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../../config.js';
import type { createStorage } from '../../../infra/storage.js';
import { themeContextObjectKey } from '../../../modules/customer-service/contexts.js';
import { currentConversation, openConversation, ownedConversation, sendContext } from '../../../modules/customer-service/conversations.js';
import { notFound, type ContextInput, type EntryPoint, type Subject } from '../../../modules/customer-service/domain.js';
import { cancelReplyNotices } from '../../../modules/customer-service/emails.js';
import { conversationChannel } from '../../../modules/customer-service/events.js';
import { customerMessagesAfter, listCustomerMessages, markCustomerRead, postCustomerMessage, type CustomerMessageInput } from '../../../modules/customer-service/messages.js';
import { touchCustomer } from '../../../modules/customer-service/presence.js';
import { issueVisitor, mergeVisitor, resolveVisitor, touchVisitor, visitorActive } from '../../../modules/customer-service/visitors.js';
import { loadConversation } from '../../../modules/customer-service/store.js';
import { revalidatePrincipal, type Principal } from '../../../modules/identity/principal.js';
import { clientUserId, issueEventTicket, requirePrincipal } from '../../authentication.js';
import { requestMessageLocale } from '../../locale.js';
import { enforceRateLimit, rateLimit } from '../../rate-limits.js';
import { streamEvents } from '../../sse.js';
import {
  contextThemeCoverSchema, currentConversationSchema, eventsSchema, messagesQuerySchema, openConversationSchema, postMessageSchema, readSchema, sendContextSchema, ticketSchema,
  visitorIssueSchema, visitorMergeSchema,
} from './schema.js';
import { requireSubject } from './subject.js';
import { clearVisitorCookie, setVisitorCookie, visitorToken } from './visitor-cookie.js';

type ConversationParams = { conversationId: string };

/** 客户流心跳：登录客户按建立时的令牌复核 Session，访客复核令牌仍有效；失效返回 false 断流，有效时续期客户在线 */
export async function customerStreamHeartbeat(pool: pg.Pool, redis: Redis, conversationId: string, subject: Subject, principal: Principal | null): Promise<boolean> {
  if (subject.kind === 'user') {
    if (!principal || !await revalidatePrincipal(pool, redis, principal)) return false;
  } else {
    await touchVisitor(pool, subject.visitorId);
    if (!await visitorActive(pool, subject.visitorId)) return false;
  }
  await touchCustomer(redis, conversationId);
  return true;
}

// 在线客服客户端接口（开发计划 §6.2）。访客以 HttpOnly Cookie 中的令牌识别（见 visitor-cookie.ts），登录身份优先。
export async function registerClientCustomerServiceRoutes(app: FastifyInstance, config: Config, pool: pg.Pool, redis: Redis,
  storage: Pick<ReturnType<typeof createStorage>, 'signDownload'>): Promise<void> {
  const secureCookie = config.nodeEnv === 'production';
  await app.register(async scope => {
    scope.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'private, no-store'); });

    scope.post('/visitors', { schema: visitorIssueSchema, preHandler: rateLimit(redis, 'csVisitorIssue') }, async (request, reply) => {
      // 幂等：已持有有效令牌时复用原访客并续期 Cookie，避免本地标记丢失后产生孤儿访客
      const existingToken = visitorToken(request);
      const existing = await resolveVisitor(pool, existingToken);
      if (existing && existingToken) {
        setVisitorCookie(reply, existingToken, secureCookie);
        return reply.code(200).send({ code: 0, data: { visitorId: existing } });
      }
      const issued = await issueVisitor(pool, requestMessageLocale(request));
      setVisitorCookie(reply, issued.visitorToken, secureCookie);
      return reply.code(201).send({ code: 0, data: { visitorId: issued.visitorId } });
    });

    scope.post('/visitors/merge', { schema: visitorMergeSchema }, async (request, reply) => {
      const userId = clientUserId(request);
      const visitorId = await resolveVisitor(pool, visitorToken(request));
      // 合并后令牌即失效，无论是否有可合并的会话都清除 Cookie
      clearVisitorCookie(reply, secureCookie);
      return { code: 0, data: { mergedConversations: visitorId ? await mergeVisitor(pool, redis, userId, visitorId) : 0 } };
    });

    scope.post<{ Body: { context?: ContextInput; entryPoint: EntryPoint } }>('/conversations', { schema: openConversationSchema }, async (request, reply) => {
      const subject = await requireSubject(request, pool);
      // 带上下文时每次都会追加卡片，与消息共用限流额度；只打开面板不计入
      if (request.body.context) await enforceMessageLimits(request, reply, subject);
      const { created, ...data } = await openConversation(pool, redis, subject, request.body, requestMessageLocale(request));
      return reply.code(created ? 201 : 200).send({ code: 0, data });
    });

    scope.get('/conversations/current', { schema: currentConversationSchema }, async request => {
      return { code: 0, data: await currentConversation(pool, redis, await requireSubject(request, pool)) };
    });

    scope.get<{ Querystring: { before?: number; after?: number; limit: number } }>('/messages', { schema: messagesQuerySchema }, async request => {
      return { code: 0, data: await listCustomerMessages(pool, await requireSubject(request, pool), request.query) };
    });

    scope.post<{ Params: ConversationParams; Body: CustomerMessageInput }>('/conversations/:conversationId/messages', { schema: postMessageSchema }, async (request, reply) => {
      const subject = await requireSubject(request, pool);
      await enforceMessageLimits(request, reply, subject, request.body.kind === 'offline');
      const { created, ...data } = await postCustomerMessage(pool, redis, subject, request.params.conversationId, request.body, requestMessageLocale(request));
      return reply.code(created ? 201 : 200).send({ code: 0, data });
    });

    scope.post<{ Params: ConversationParams; Body: { context: ContextInput; entryPoint: EntryPoint } }>('/conversations/:conversationId/contexts', {
      schema: sendContextSchema,
    }, async (request, reply) => {
      const subject = await requireSubject(request, pool);
      await enforceMessageLimits(request, reply, subject);
      const data = await sendContext(pool, redis, subject, request.params.conversationId, request.body, requestMessageLocale(request));
      return reply.code(201).send({ code: 0, data });
    });

    // 客户与坐席的 <img> 都带不了 Bearer，凭只在会话内可见的上下文 ID 换签；浏览器缓存短于签名有效期
    scope.get<{ Params: { contextId: string } }>('/contexts/:contextId/theme-cover', { schema: contextThemeCoverSchema }, async (request, reply) => {
      const url = await storage.signDownload(await themeContextObjectKey(pool, request.params.contextId), 300);
      reply.header('Cache-Control', 'private, max-age=240');
      return reply.redirect(url, 302);
    });

    scope.post<{ Params: ConversationParams; Body: { seq: number } }>('/conversations/:conversationId/read', { schema: readSchema }, async request => {
      const subject = await requireSubject(request, pool);
      return { code: 0, data: await markCustomerRead(pool, redis, subject, request.params.conversationId, request.body.seq) };
    });

    scope.post<{ Params: ConversationParams }>('/conversations/:conversationId/events-ticket', { schema: ticketSchema }, async request => {
      const subject = await requireSubject(request, pool);
      await ownedConversation(pool, subject, request.params.conversationId);
      const ticket = await issueEventTicket(redis, 'cs', subject.kind === 'user'
        ? { subject: request.params.conversationId, userId: subject.userId, token: requirePrincipal(request, 'client').token }
        : { subject: request.params.conversationId, visitorId: subject.visitorId });
      return { code: 0, data: { ticket } };
    });

    scope.get<{ Params: ConversationParams; Querystring: { ticket: string; after?: number } }>('/conversations/:conversationId/events', {
      config: { authentication: 'events', eventTicketPrefix: 'cs', eventTicketParam: 'conversationId' }, schema: eventsSchema,
    }, async (request, reply) => {
      const subject = await eventSubject(request);
      const conversationId = request.params.conversationId;
      await ownedConversation(pool, subject, conversationId);
      await streamEvents(redis, reply, {
        channels: [conversationChannel(conversationId)],
        // 客户上线：取消待发的回复提醒并标记在线
        onOpen: async () => { await touchCustomer(redis, conversationId); await cancelReplyNotices(pool, conversationId); },
        replay: async () => {
          const messages = await customerMessagesAfter(pool, conversationId, request.query.after ?? 0);
          const conversation = await loadConversation(pool, conversationId);
          return [...messages.map(message => ({ type: 'message.created', message })), { type: 'ready', conversation: conversation?.customer ?? null }];
        },
        onHeartbeat: () => customerStreamHeartbeat(pool, redis, conversationId, subject, request.principal),
      });
    });

    async function eventSubject(request: FastifyRequest): Promise<Subject> {
      if (request.principal) return { kind: 'user', userId: clientUserId(request) };
      if (request.csVisitorId && await visitorActive(pool, request.csVisitorId)) return { kind: 'visitor', visitorId: request.csVisitorId };
      throw notFound();
    }

    // 登录用户每分钟 20 条；访客每分钟 10 条且同一 IP 每分钟 30 条；访客留言每小时 5 条。上下文卡片与普通消息共用额度
    async function enforceMessageLimits(request: FastifyRequest, reply: FastifyReply, subject: Subject, offline = false) {
      if (subject.kind === 'user') return enforceRateLimit(redis, request, reply, 'csUserMessage');
      await enforceRateLimit(redis, request, reply, 'csVisitorMessage');
      await enforceRateLimit(redis, request, reply, 'csIpMessage');
      if (offline) await enforceRateLimit(redis, request, reply, 'csOffline');
    }
  }, { prefix: '/customer-service' });
}
