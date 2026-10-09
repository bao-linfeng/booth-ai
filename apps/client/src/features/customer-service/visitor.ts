import { issueVisitor, mergeVisitor } from '@/services/api/customer-service'

// 客服访客令牌由服务端写入 HttpOnly Cookie，脚本读不到（计划 R4）；本地只记一个不含机密的标记，表示已签发过访客。
// 访客只用于在线客服与匿名项目绑定，和检索用的 x-visitor-id 互相独立（计划 G7）
export const CS_VISITOR_MARKER_KEY = 'booth-ai:cs-visitor'

export function hasVisitor(): boolean {
  try { return localStorage.getItem(CS_VISITOR_MARKER_KEY) === '1' } catch { return false }
}

export function clearVisitor() {
  try { localStorage.removeItem(CS_VISITOR_MARKER_KEY) } catch {}
}

let issuing: Promise<void> | null = null

/** 懒签发：已有标记直接返回；并发调用共享同一个签发请求（服务端在 Cookie 仍有效时复用原访客） */
export function ensureVisitor(): Promise<void> {
  if (hasVisitor()) return Promise.resolve()
  issuing ??= issueVisitor()
    .then(() => { localStorage.setItem(CS_VISITOR_MARKER_KEY, '1') })
    .finally(() => { issuing = null })
  return issuing
}

let merging: Promise<void> | null = null

/**
 * 登录后把访客会话合并到账号（服务端读取 Cookie，合并成功或确认令牌失效后清除）。
 * 只有请求成功才清除本地标记；失败只记录日志并保留标记，下次登录态的客服请求前再重试（服务端合并幂等）。
 * 并发调用共享同一个请求，从不抛错。
 */
export function mergePendingVisitor(): Promise<void> {
  if (!hasVisitor()) return Promise.resolve()
  merging ??= mergeVisitor()
    .then(() => { clearVisitor() }, (error) => { console.warn('Customer service visitor merge failed', error) })
    .finally(() => { merging = null })
  return merging
}
