import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { getSession } from '../../../infra/session.js';
import { requirementSchema } from '../selection/domain.js';
import { createManualRequest, type ManualRequestInput } from './service.js';

const text = { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' };
const difference = { type: 'object', additionalProperties: false, required: ['field', 'requested', 'actual', 'reason'], properties: {
  field: text, requested: text, actual: text, reason: text,
} };

export async function registerClientManualRequestRoutes(app: FastifyInstance, pool: pg.Pool, redis: Redis): Promise<void> {
  app.post<{ Body: ManualRequestInput }>('/manual-requests', { schema: {
    tags: ['client-manual-requests'], summary: '提交人工需求（允许匿名）',
    body: { type: 'object', additionalProperties: false,
      required: ['requestKey', 'contactName', 'contactDetail', 'originalText', 'requirement', 'unresolvedQuestions'],
      properties: {
        requestKey: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' },
        contactName: { ...text, maxLength: 100 },
        contactDetail: { ...text, maxLength: 254 },
        originalText: { type: 'string', maxLength: 1000 },
        requirement: requirementSchema,
        unresolvedQuestions: { type: 'array', maxItems: 30, items: { ...text, maxLength: 1000 } },
        schemeContext: { type: 'object', additionalProperties: false, required: ['code', 'differences', 'pendingConfirmations'], properties: {
          code: { ...text, maxLength: 200 },
          differences: { type: 'array', maxItems: 30, items: difference },
          pendingConfirmations: { type: 'array', maxItems: 30, items: text },
        } },
      },
    },
  } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const rateKey = `manual-request:rate:${createHash('sha256').update(request.ip).digest('hex')}:${Math.floor(Date.now() / 60000)}`;
    const count = await redis.eval('local n = redis.call("INCR", KEYS[1]); if n == 1 then redis.call("EXPIRE", KEYS[1], 60) end; return n', 1, rateKey);
    if (Number(count) > 10) {
      reply.header('Retry-After', '60');
      throw Object.assign(new Error('Rate limited'), { statusCode: 429 });
    }
    const authorization = request.headers.authorization;
    const token = authorization ? /^Bearer\s+(.+)$/i.exec(authorization)?.[1] : undefined;
    const session = token ? await getSession(redis, token, 'client') : null;
    if (authorization && !session) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
    if (session) {
      const user = (await pool.query<{ enabled: boolean }>('SELECT enabled FROM users WHERE id=$1', [session.localId])).rows[0];
      if (!user?.enabled) throw Object.assign(new Error('Account disabled'), { statusCode: 403 });
    }
    return { code: 0, data: await createManualRequest(pool, request.body, session?.localId ?? null) };
  });
}
