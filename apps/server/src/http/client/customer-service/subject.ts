import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { csError, type Subject } from '../../../modules/customer-service/domain.js';
import { resolveVisitor, touchVisitor } from '../../../modules/customer-service/visitors.js';
import { clientUserId } from '../../authentication.js';
import { visitorToken } from './visitor-cookie.js';

/**
 * 客户主体：登录身份优先；否则读取访客 Cookie（需带 X-CS-Visitor 头）。都没有或令牌无效（不存在、已删除、已合并）时 401 VISITOR_REQUIRED，
 * 客户端收到后清除本地访客标记并重新签发。解析出的访客写入 request.csVisitorId，供 visitor 限流使用。
 */
export async function requireSubject(request: FastifyRequest, pool: pg.Pool): Promise<Subject> {
  if (request.principal) return { kind: 'user', userId: clientUserId(request) };
  const visitorId = await resolveVisitor(pool, visitorToken(request));
  if (!visitorId) throw csError('VISITOR_REQUIRED', 401);
  request.csVisitorId = visitorId;
  await touchVisitor(pool, visitorId);
  return { kind: 'visitor', visitorId };
}
