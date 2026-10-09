import type { FastifyReply, FastifyRequest } from 'fastify';

// 访客令牌只放在 HttpOnly Cookie 中，前端脚本读不到（开发计划 R4）；Path 覆盖客服与匿名项目提交接口
const COOKIE = 'booth_cs_visitor';
const PATH = '/api/v1/client';
// 浏览器 Cookie 有效期上限为 400 天；服务端访客按最后活跃 6 个月清理，过期令牌返回 VISITOR_REQUIRED 后由前端重新签发
const MAX_AGE_SECONDS = 400 * 24 * 3600;

/**
 * CSRF 防护：只有带 `X-CS-Visitor: 1` 的请求才读取访客 Cookie。跨站页面要附加自定义头必须先通过 CORS 预检，
 * 而预检只放行 CORS_ORIGINS；SameSite=Lax 作为第二层防护。
 */
export function visitorToken(request: FastifyRequest): string | null {
  if (request.headers['x-cs-visitor'] !== '1') return null;
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === COOKIE) return part.slice(index + 1).trim() || null;
  }
  return null;
}

function cookie(value: string, maxAge: number, secure: boolean) {
  return `${COOKIE}=${value}; Path=${PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** 令牌由服务端生成（base64url），无需编码 */
export function setVisitorCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.header('set-cookie', cookie(token, MAX_AGE_SECONDS, secure));
}

export function clearVisitorCookie(reply: FastifyReply, secure: boolean): void {
  reply.header('set-cookie', cookie('', 0, secure));
}
