import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { getSchemeImages } from '@/services/api/selection'
import type { MatchItem, MatchResponse, SchemeImage } from './types'

// 拿到链接后按 270 秒有效期计，剩余不足 30 秒即换新；页面可见时每分钟检查一次
const linkLifetimeMs = 270_000
const refreshMarginMs = 30_000
const pollIntervalMs = 60_000

/**
 * 匹配结果图片的链接生命周期：记录链接有效期与每个方案当前展示的图片序号，过期后按 assetId 换新链接。
 * 换链接直接替换 match 中的 items；刷新期间结果被替换（重新匹配、重置、切换预览）或页面卸载则丢弃本次刷新。
 */
export function useSchemeImages(match: Ref<MatchResponse | null>, enabled: () => boolean) {
  const activeImageByCode = ref<Record<string, number>>({})
  const imagesExpiresAt = ref(0)
  let refreshing = false
  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined

  function markFresh() {
    imagesExpiresAt.value = Date.now() + linkLifetimeMs
    activeImageByCode.value = {}
  }

  function clear() {
    imagesExpiresAt.value = 0
    activeImageByCode.value = {}
  }

  function restore(expiresAt: number, active: Record<string, number>) {
    imagesExpiresAt.value = expiresAt
    activeImageByCode.value = Object.fromEntries((match.value?.items ?? []).map(item => {
      const index = active[item.code]
      return [item.code, typeof index === 'number' && index < item.images.length ? index : 0]
    }))
  }

  async function refreshItem(item: MatchItem): Promise<MatchItem | null> {
    try {
      const images = await getSchemeImages(item.code)
      const fresh = item.images.map(image => images.find(candidate => candidate.assetId === image.assetId))
      return fresh.every(Boolean) ? { ...item, images: fresh as SchemeImage[] } : null
    } catch {
      return null
    }
  }

  async function refreshExpired() {
    const items = match.value?.items
    if (refreshing || disposed || !enabled() || !items?.length || imagesExpiresAt.value > Date.now() + refreshMarginMs) return
    refreshing = true
    try {
      const refreshed = await Promise.all(items.map(refreshItem))
      if (disposed || !enabled() || !match.value || match.value.items !== items) return
      match.value = { ...match.value, items: refreshed.map((item, index) => item ?? items[index]) }
      if (refreshed.every(Boolean)) imagesExpiresAt.value = Date.now() + linkLifetimeMs
    } finally {
      refreshing = false
    }
  }

  function refreshWhenVisible() {
    if (!document.hidden) void refreshExpired()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', refreshWhenVisible)
    timer = setInterval(refreshWhenVisible, pollIntervalMs)
  })

  onUnmounted(() => {
    disposed = true
    document.removeEventListener('visibilitychange', refreshWhenVisible)
    if (timer) clearInterval(timer)
  })

  return { activeImageByCode, imagesExpiresAt, markFresh, clear, restore, refreshExpired }
}
