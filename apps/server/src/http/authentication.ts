import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { SessionSite } from '../infra/session.js';
import { authenticationError, resolvePrincipal, type Principal } from '../modules/identity/principal.js';

declare module 'fastify' {
  interface FastifyRequest { principal: Principal | null }
  interface FastifyContextConfig {
    authentication?: 'public' | 'events';
    eventTicketPrefix?: 'theme' | 'artwork';
  }
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

export function adminUserId(request: FastifyRequest): string {
  return requirePrincipal(request, 'admin').localId;
}

export function registerAuthentication(app: FastifyInstance, pool: pg.Pool, redis: Redis, site: SessionSite): void {
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async request => {
    const policy = request.routeOptions.config;
    if (policy.authentication === 'public') return;
    let token = authorizationToken(request.headers.authorization);
    type EventTicket = { jobId: string; userId: string; token: string };
    let ticket: EventTicket | null = null;
    if (policy.authentication === 'events') {
      const id = (request.query as { ticket?: string }).ticket;
      if (!id) return;
      const raw = await redis.getdel(`${policy.eventTicketPrefix}-events-ticket:${id}`);
      try { ticket = raw ? JSON.parse(raw) as EventTicket : null; } catch { throw authenticationError(); }
      if (!ticket || ticket.jobId !== (request.params as { jobId: string }).jobId || typeof ticket.token !== 'string') throw authenticationError();
      token = ticket.token;
    }
    if (!token) {
      if (site === 'admin' || request.headers.authorization) throw authenticationError();
      return;
    }
    request.principal = await resolvePrincipal(pool, redis, token, site);
    if (ticket && ticket.userId !== request.principal.localId) throw authenticationError();
  });
}
