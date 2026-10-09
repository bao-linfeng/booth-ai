// 访客 ID（localStorage）：随请求发送给服务端用于检索记录归属；智选会话也用它判断是否属于当前访客
const visitorKey = 'booth-ai:visitor-id'

function createVisitorId() {
  const created = `v_${crypto.randomUUID().replaceAll('-', '')}`
  localStorage.setItem(visitorKey, created)
  return created
}

export function getVisitorId() {
  return localStorage.getItem(visitorKey) || createVisitorId()
}

/** 登录身份失效时调用，生成新的访客 ID，防止以访客身份读取前一位登录用户的检索记录 */
export function rotateVisitorId() {
  return createVisitorId()
}
