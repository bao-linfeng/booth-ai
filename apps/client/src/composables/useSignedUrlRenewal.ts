import { onMounted, onUnmounted } from 'vue'

// 刚拿到的链接加载失败不是过期所致，不触发续期，避免真正损坏的图片反复请求
const freshWindowMs = 30_000

/**
 * 预签名图片链接的续期。链接有效期内仍可能有图片尚未加载（切换大图、缓存未命中），过期后加载就会失败。
 * 图片加载失败、或页面重新可见且链接接近过期时，重新读取页面数据换新链接；不改变用户选择，也不新建任务。
 * 调用方在每次拿到新链接时调用 markFresh。
 */
export function useSignedUrlRenewal(reload: () => Promise<unknown>, lifetimeMs: number) {
  let issuedAt = Date.now()
  let renewing = false

  function markFresh() {
    issuedAt = Date.now()
  }

  async function renew() {
    if (renewing) return
    renewing = true
    try { await reload() } catch { /* 续期失败时保留现有展示，下次失败或重新可见时再试 */ } finally { renewing = false }
  }

  function onImageError() {
    if (Date.now() - issuedAt >= freshWindowMs) void renew()
  }

  function renewWhenVisible() {
    if (!document.hidden && Date.now() - issuedAt >= lifetimeMs - freshWindowMs) void renew()
  }

  onMounted(() => document.addEventListener('visibilitychange', renewWhenVisible))
  onUnmounted(() => document.removeEventListener('visibilitychange', renewWhenVisible))

  return { markFresh, onImageError }
}
