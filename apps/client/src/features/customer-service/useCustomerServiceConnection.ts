import { createEventsTicket, openCustomerServiceEvents, type CustomerEvent } from '@/services/api/customer-service'

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'polling'

interface Handlers {
  onEvent: (event: CustomerEvent) => void
  onState: (state: ConnectionState) => void
  /** 断线期间每 5 秒调用一次，补拉消息与会话状态 */
  poll: () => Promise<void>
  /** 每次（重新）连上后调用：重新读取坐席在线状态；连接期间由服务端心跳推送 presence 事件更新 */
  onReconnected: () => void
  after: () => number
}

/** 服务端每 15 秒发一次 ping；连续 45 秒收不到任何事件就视为断线（代理吞掉上游断开时浏览器收不到 error） */
export const STALE_MS = 45_000

/**
 * 会话 SSE：先订阅后补发（after=已知最大 seq）。断线时降级为每 5 秒轮询，
 * 同时按 3、6、12……秒（上限 30 秒）退避重连，连上后回到实时。
 */
export function useCustomerServiceConnection(handlers: Handlers) {
  let source: EventSource | null = null
  let conversationId: string | null = null
  let attempt = 0
  /** 每次 open/close 递增，用来识别过期的建连结果 */
  let session = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let staleTimer: ReturnType<typeof setTimeout> | undefined

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
  }

  function startPolling() {
    if (pollTimer) return
    handlers.onState('polling')
    pollTimer = setInterval(() => { void handlers.poll().catch(() => undefined) }, 5000)
  }

  function scheduleReconnect() {
    if (!conversationId) return
    startPolling()
    attempt++
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => { void connect() }, Math.min(3000 * 2 ** (attempt - 1), 30_000))
  }

  function fail(next: EventSource) {
    next.close()
    if (source !== next) return
    clearTimeout(staleTimer)
    source = null
    scheduleReconnect()
  }

  function arm(next: EventSource) {
    clearTimeout(staleTimer)
    staleTimer = setTimeout(() => fail(next), STALE_MS)
  }

  async function connect() {
    const id = conversationId
    if (!id) return
    // 等票据期间 close/open 过（含退出后同一会话被新身份重新打开）就丢弃这次结果，避免多出一条无人关闭的连接
    const current = session
    if (!pollTimer) handlers.onState('connecting')
    try {
      const ticket = await createEventsTicket(id)
      if (session !== current) return
      const next = openCustomerServiceEvents(id, ticket, handlers.after())
      source = next
      arm(next)
      next.addEventListener('ping', () => arm(next))
      next.addEventListener('update', message => {
        arm(next)
        try { handlers.onEvent(JSON.parse((message as MessageEvent<string>).data) as CustomerEvent) } catch {}
      })
      next.addEventListener('open', () => {
        arm(next)
        attempt = 0
        stopPolling()
        handlers.onState('live')
        handlers.onReconnected()
      })
      next.onerror = () => fail(next)
    } catch {
      if (session === current) scheduleReconnect()
    }
  }

  function open(id: string) {
    if (conversationId === id && source) return
    close()
    session++
    conversationId = id
    attempt = 0
    void connect()
  }

  function close() {
    session++
    conversationId = null
    source?.close()
    source = null
    clearTimeout(reconnectTimer)
    clearTimeout(staleTimer)
    stopPolling()
    handlers.onState('idle')
  }

  return { open, close }
}
