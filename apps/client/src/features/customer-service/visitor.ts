import { issueVisitor, mergeVisitor } from '@/services/api/customer-service'

// 客服访客令牌：服务端签发，只用于在线客服与匿名项目绑定，和检索用的 x-visitor-id 互相独立（计划 G7）
export const CS_VISITOR_TOKEN_KEY = 'booth-ai:cs-visitor-token'

export function readVisitorToken(): string | null {
  try { return localStorage.getItem(CS_VISITOR_TOKEN_KEY) } catch { return null }
}

export function clearVisitorToken() {
  try { localStorage.removeItem(CS_VISITOR_TOKEN_KEY) } catch {}
}

let issuing: Promise<string> | null = null

/** 懒签发：本地已有令牌直接返回；并发调用共享同一个签发请求 */
export function ensureVisitorToken(): Promise<string> {
  const existing = readVisitorToken()
  if (existing) return Promise.resolve(existing)
  issuing ??= issueVisitor()
    .then(({ visitorToken }) => { localStorage.setItem(CS_VISITOR_TOKEN_KEY, visitorToken); return visitorToken })
    .finally(() => { issuing = null })
  return issuing
}

/** 登录后把本地访客会话合并到账号；无论成功与否都清除本地令牌（失败只记录日志） */
export async function mergeVisitorAfterLogin() {
  const token = readVisitorToken()
  if (!token) return
  clearVisitorToken()
  try { await mergeVisitor(token) } catch (error) { console.warn('Customer service visitor merge failed', error) }
}
