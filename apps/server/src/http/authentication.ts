import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { SessionSite } from '../infra/session.js';
import { authenticationError, resolvePrincipal, revalidatePrincipal, type Principal } from '../modules/identity/principal.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
    /** 客服访客 ID：访客事件票据或访客 Cookie 鉴权后写入，不建立 principal；也用作 visitor 限流身份 */
    csVisitorId: string | null;
  }
  interface FastifyContextConfig {
    authentication?: 'public' | 'events';
    eventTicketPrefix?: EventTicketPrefix;
    /** 票据 subject 对应的路由参数，缺省 jobId；null 表示固定 subject 'workbench' */
    eventTicketParam?: string | null;
  }
}

export type EventTicketPrefix = 'theme' | 'artwork' | 'cs' | 'cs-admin';
/** SSE 一次性票据：登录主体带 token + userId，客服访客只带 visitorId */
export type EventTicket = { subject: string; token?: string; userId?: string; visitorId?: string };

export async function issueEventTicket(redis: Redis, prefix: EventTicketPrefix, ticket: EventTicket): Promise<string> {
  const id = randomUUID();
  await redis.set(`${prefix}-events-ticket:${id}`, JSON.stringify(ticket), 'EX', 300);
  return id;
}

export function authorizationToken(authorization: string | undefined): string | null {
  return /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim() || null;
}

export function requirePrincipal(request: FastifyRequest, site: SessionSite): Principal {
  if (!request.principal || request.principal.site !== site) throw authenticationError();
  return request.principal;
}

export function clientUserId(request: FastifyRequest): string {
  return requirePrincipal(request, 'client').localId;
}

// 允许访客访问的接口：未登录返回 null，携带其他站点会话仍视为认证失败
export function optionalClientUserId(request: FastifyRequest): string | null {
  return request.principal ? clientUserId(request) : null;
}

export function adminUserId(request: FastifyRequest): string {
  return requirePrincipal(request, 'admin').localId;
}

/** SSE 心跳复核：按建连时的令牌重新校验登录 Session 与账户，失效时返回 false 断流 */
export function sessionHeartbeat(pool: pg.Pool, redis: Redis, principal: Principal): () => Promise<boolean> {
  return async () => (await revalidatePrincipal(pool, redis, principal)) !== null;
}

export function registerAuthentication(app: FastifyInstance, pool: pg.Pool, redis: Redis, site: SessionSite): void {
  app.decorateRequest('principal', null);
  app.decorateRequest('csVisitorId', null);
  app.addHook('onRequest', async request => {
    const policy = request.routeOptions.config;
    if (policy.authentication === 'public') return;
    let token = authorizationToken(request.headers.authorization);
    let ticket: EventTicket | null = null;
    if (policy.authentication === 'events') {
      const id = (request.query as { ticket?: string }).ticket;
      if (!id) return;
      const raw = await redis.getdel(`${policy.eventTicketPrefix}-events-ticket:${id}`);
      try { ticket = raw ? JSON.parse(raw) as EventTicket : null; } catch { throw authenticationError(); }
      const param = policy.eventTicketParam === undefined ? 'jobId' : policy.eventTicketParam;
      const subject = param === null ? 'workbench' : (request.params as Record<string, string | undefined>)[param];
      if (!ticket || typeof ticket.subject !== 'string' || ticket.subject !== subject) throw authenticationError();
      if (typeof ticket.token === 'string') token = ticket.token;
      else if (site === 'client' && typeof ticket.visitorId === 'string') { request.csVisitorId = ticket.visitorId; return; }
      else throw authenticationError();
    }
    if (!token) {
      if (site === 'admin' || request.headers.authorization) throw authenticationError();
      return;
    }
    request.principal = await resolvePrincipal(pool, redis, token, site);
    if (ticket && ticket.userId !== request.principal.localId) throw authenticationError();
  });
}
