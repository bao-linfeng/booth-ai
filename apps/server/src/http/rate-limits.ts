import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

export const rateLimitPolicies = {
  login: { max: 20, windowSeconds: 60, identity: 'ip' },
  generation: { max: 10, windowSeconds: 60, identity: 'user' },
  quote: { max: 10, windowSeconds: 60, identity: 'user' },
  manual: { max: 10, windowSeconds: 60, identity: 'user' },
  anonymousProject: { max: 5, windowSeconds: 600, identity: 'ip' },
  selection: { max: 60, windowSeconds: 60, identity: 'ip' },
} as const;

type PolicyName = keyof typeof rateLimitPolicies;

// anonymous：允许访客调用的接口，未登录请求改用该策略计数
export function rateLimit(redis: Redis, policyName: PolicyName, anonymous?: PolicyName) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const name = anonymous && !request.principal ? anonymous : policyName;
    const policy = rateLimitPolicies[name];
    const identity = policy.identity === 'user' ? request.principal?.localId : request.ip;
    if (!identity) throw Object.assign(new Error('Authentication required'), { statusCode: 401, reason: 'AUTH_REQUIRED' });
    const digest = createHash('sha256').update(identity).digest('hex');
    const window = Math.floor(Date.now() / (policy.windowSeconds * 1000));
    const key = `rate:${request.principal?.site ?? request.routeOptions.url?.split('/')[3] ?? 'public'}:${name}:${digest}:${window}`;
    const count = await redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],ARGV[1]) end; return n', 1, key, policy.windowSeconds);
    if (Number(count) > policy.max) {
      reply.header('Retry-After', String(policy.windowSeconds));
      throw Object.assign(new Error('Rate limited'), { statusCode: 429, reason: 'RATE_LIMITED' });
    }
  };
}
