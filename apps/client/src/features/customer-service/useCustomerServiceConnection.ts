import { createEventsTicket, openCustomerServiceEvents, type CustomerEvent } from '@/services/api/customer-service'

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'polling'

interface Handlers {
  onEvent: (event: CustomerEvent) => void
  onState: (state: ConnectionState) => void
  /** 断线期间每 5 秒调用一次，补拉消息与会话状态 */
  poll: () => Promise<void>
  /** 每次（重新）连上后调用：重新读取坐席在线状态 */
  onReconnected: () => void
  after: () => number
}

/**
 * 会话 SSE：先订阅后补发（after=已知最大 seq）。断线时降级为每 5 秒轮询，
 * 同时按 3、6、12……秒（上限 30 秒）退避重连，连上后回到实时。
 */
export function useCustomerServiceConnection(handlers: Handlers) {
  let source: EventSource | null = null
  let conversationId: string | null = null
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined

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

  async function connect() {
    const id = conversationId
    if (!id) return
    if (!pollTimer) handlers.onState('connecting')
    try {
      const ticket = await createEventsTicket(id)
      if (conversationId !== id) return
      const next = openCustomerServiceEvents(id, ticket, handlers.after())
      source = next
      next.addEventListener('update', message => {
        try { handlers.onEvent(JSON.parse((message as MessageEvent<string>).data) as CustomerEvent) } catch {}
      })
      next.addEventListener('open', () => {
        attempt = 0
        stopPolling()
        handlers.onState('live')
        handlers.onReconnected()
      })
      next.onerror = () => {
        next.close()
        if (source === next) source = null
        scheduleReconnect()
      }
    } catch {
      scheduleReconnect()
    }
  }

  function open(id: string) {
    if (conversationId === id && source) return
    close()
    conversationId = id
    attempt = 0
    void connect()
  }

  function close() {
    conversationId = null
    source?.close()
    source = null
    clearTimeout(reconnectTimer)
    stopPolling()
    handlers.onState('idle')
  }

  return { open, close }
}
