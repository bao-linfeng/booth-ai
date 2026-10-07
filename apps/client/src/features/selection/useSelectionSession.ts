import { onUnmounted, watch, type Ref } from 'vue'
import { clearSelectionSession, readSelectionSession, writeSelectionSession, type PersistedSelection, type SelectionSessionInput } from './session'

/**
 * 智选会话的自动保存与恢复。live 为 false（预览模式）时不读不写：切到预览前先保存真实会话，切回后再恢复。
 * 存储里没有会话（首次进入或刚重置）且之后没有任何改动时不落盘，避免写入空白会话。
 */
export function useSelectionSession(options: {
  live: Ref<boolean>
  snapshot: () => SelectionSessionInput
  restore: (value: PersistedSelection) => void
  clear: () => void
}) {
  let stopWatching: (() => void) | undefined
  let empty = false

  function start() {
    stopWatching?.()
    stopWatching = undefined
    if (!options.live.value) return
    stopWatching = watch(options.snapshot, value => {
      empty = false
      writeSelectionSession(value)
    }, { deep: true, flush: 'post' })
  }

  function load() {
    const saved = readSelectionSession()
    if (saved) options.restore(saved)
    empty = !saved
    start()
  }

  function save() {
    if (options.live.value && !empty) writeSelectionSession(options.snapshot())
  }

  function reset() {
    stopWatching?.()
    options.clear()
    if (options.live.value) {
      empty = true
      clearSelectionSession()
    }
    start()
  }

  if (options.live.value) load()

  watch(options.live, live => {
    if (!live && !empty) writeSelectionSession(options.snapshot())
    stopWatching?.()
    options.clear()
    if (live) load()
  })

  onUnmounted(() => {
    save()
    stopWatching?.()
  })

  return { reset }
}
