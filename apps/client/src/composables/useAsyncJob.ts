import { onUnmounted } from 'vue'

// SSE can stall silently (connection never reaches the API, proxy keeps a dead upstream open), so pending jobs are
// also re-fetched on this slower cadence; SSE remains the fast path.
export const FALLBACK_POLL_MS = 10_000

interface AsyncJobOptions<T> {
  fetch: (id: string) => Promise<T>
  createEventsTicket: (id: string) => Promise<string>
  openEvents: (id: string, ticket: string, onUpdate: () => void, onError: () => void) => EventSource
  isPending: (data: T) => boolean
  onData: (data: T) => void
  onError: (error: unknown, initial: boolean) => void
  reconnectDelay?: (error: unknown, initial: boolean) => number | null
}

export function useAsyncJob<T>(options: AsyncJobOptions<T>) {
  let activeId: string | undefined
  let generation = 0
  let events: EventSource | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let connectingGeneration: number | undefined
  let fetchingGeneration: number | undefined
  let refreshRequestedGeneration: number | undefined
  let pending = false
  let refreshWaiters: Array<{ generation: number; resolve: (succeeded: boolean) => void }> = []
  let disposed = false

  function closeEvents() {
    events?.close()
    events = undefined
  }

  function cancelReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  function cancelFallback() {
    if (fallbackTimer) clearTimeout(fallbackTimer)
    fallbackTimer = undefined
  }

  function scheduleFallback(version: number, id: string) {
    cancelFallback()
    fallbackTimer = setTimeout(() => {
      fallbackTimer = undefined
      if (isCurrent(version, id)) void refresh()
    }, FALLBACK_POLL_MS)
  }

  function stop() {
    generation += 1
    activeId = undefined
    pending = false
    refreshRequestedGeneration = undefined
    refreshWaiters.forEach(waiter => waiter.resolve(false))
    refreshWaiters = []
    closeEvents()
    cancelReconnect()
    cancelFallback()
  }

  function isCurrent(version: number, id: string) {
    return !disposed && generation === version && activeId === id
  }

  function scheduleReconnect(version: number, id: string, delay: number) {
    closeEvents()
    cancelReconnect()
    if (!isCurrent(version, id)) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void refresh()
    }, delay)
  }

  async function connectEvents(version: number, id: string) {
    if (!isCurrent(version, id) || events || connectingGeneration === version) return
    connectingGeneration = version
    try {
      const ticket = await options.createEventsTicket(id)
      if (!isCurrent(version, id)) return
      events = options.openEvents(id, ticket, () => { void refresh() }, () => {
        scheduleReconnect(version, id, 3000)
      })
    } catch (error) {
      const delay = options.reconnectDelay ? options.reconnectDelay(error, false) : 3000
      if (delay !== null) scheduleReconnect(version, id, delay)
    } finally {
      if (connectingGeneration === version) connectingGeneration = undefined
    }
  }

  async function refresh(initial = false): Promise<boolean> {
    const id = activeId
    const version = generation
    if (!id || !isCurrent(version, id)) return false
    if (fetchingGeneration === version) {
      refreshRequestedGeneration = version
      return new Promise(resolve => refreshWaiters.push({ generation: version, resolve }))
    }
    fetchingGeneration = version
    cancelReconnect()
    cancelFallback()
    let succeeded = false
    try {
      const data = await options.fetch(id)
      if (!isCurrent(version, id)) return false
      options.onData(data)
      succeeded = true
      pending = options.isPending(data)
      if (pending) {
        scheduleFallback(version, id)
        void connectEvents(version, id)
      } else {
        closeEvents()
        cancelReconnect()
      }
    } catch (error) {
      if (!isCurrent(version, id)) return false
      options.onError(error, initial)
      const delay = options.reconnectDelay ? options.reconnectDelay(error, initial) : 3000
      if (delay !== null && pending) scheduleReconnect(version, id, delay)
      else closeEvents()
    } finally {
      if (fetchingGeneration === version) fetchingGeneration = undefined
      const shouldRefreshAgain = refreshRequestedGeneration === version && isCurrent(version, id) && pending
      if (refreshRequestedGeneration === version) {
        refreshRequestedGeneration = undefined
      }
      if (shouldRefreshAgain) void refresh()
      else {
        refreshWaiters = refreshWaiters.filter(waiter => {
          if (waiter.generation !== version) return true
          waiter.resolve(succeeded)
          return false
        })
      }
    }
    return succeeded
  }

  function start(id: string, initial = true): Promise<boolean> {
    if (activeId === id) return refresh(initial)
    stop()
    activeId = id
    return refresh(initial)
  }

  onUnmounted(() => {
    disposed = true
    stop()
  })

  return { start, refresh, stop }
}
