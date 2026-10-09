import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { getQuoteContext, type QuoteContext, type QuoteRequest } from '@/services/api/quote-requests'
import { getThemeJob } from '@/services/api/theme-jobs'
import { getArtworkJob } from '@/services/api/artwork-jobs'
import { getSchemeImages } from '@/services/api/selection'

/** 资料与路由带入的主题/素材不匹配：重试无意义，需返回确认 */
class ContextMismatch extends Error {}

/**
 * 报价上下文：方案当前版本，以及路由带入的主题结果与素材任务（themeJobId / artworkJobId）。
 * 主题、素材必须与当前方案和已选主题版本一致才会随申请提交；路由带的 bomRevision 落后于当前版本时标记冲突，需刷新确认。
 * 读取失败分为两类：网络或服务暂不可用（retryable，可就地重试，表单保留），资料不可用或不一致（给出具体原因）。
 */
export function useQuoteContext(code: string, enabled: boolean, status: { error: Ref<string>; conflict: Ref<boolean> }) {
  const route = useRoute()
  const router = useRouter()
  const { t } = useI18n()
  const auth = useAuthStore()
  const context = ref<QuoteContext | null>(null)
  const theme = ref<QuoteRequest['themeSelection']>()
  const themePreview = ref('')
  const standardPreview = ref('')
  const artworkJobId = ref<string>()
  /** 主题任务的来源检索：undefined 表示尚未读到主题任务，null 表示任务不来自智选检索 */
  const themeSearchId = ref<string | null>()
  const loading = ref(true)
  const retryable = ref(false)
  // 每次加载递增；旧加载的响应（重试连点、页面已卸载）不再写入
  let seq = 0

  function failureMessage(failure: unknown) {
    if (failure instanceof ContextMismatch) return { message: failure.message, retry: false }
    const statusCode = (failure as { response?: { status?: number } }).response?.status
    if (statusCode === 401) return { message: t('quoteRequest.errorAuthFailed'), retry: false }
    if (statusCode === 404 || statusCode === 409) return { message: t('quoteRequest.errorSchemeChanged'), retry: false }
    return { message: t('quoteRequest.errorContextLoadFailed'), retry: true }
  }

  async function load() {
    if (!enabled) { loading.value = false; return }
    const current = ++seq
    const alive = () => current === seq
    loading.value = true
    retryable.value = false
    status.error.value = ''
    context.value = null
    theme.value = undefined
    artworkJobId.value = undefined
    themeSearchId.value = undefined
    themePreview.value = ''
    standardPreview.value = ''
    try {
      const loaded = await getQuoteContext(code)
      if (!alive()) return
      void getSchemeImages(code).then(images => { if (alive()) standardPreview.value = images[0]?.url ?? '' }).catch(() => { if (alive()) standardPreview.value = '' })
      if (typeof route.query.bomRevision === 'string' && Number(route.query.bomRevision) !== loaded.bomRevision) {
        status.conflict.value = true
        status.error.value = t('quoteRequest.errorBomStale')
      }
      const jobId = route.query.themeJobId
      if (route.query.artworkJobId && typeof jobId !== 'string') throw new ContextMismatch(t('quoteRequest.errorArtworkNoTheme'))
      if (typeof jobId === 'string') {
        if (!auth.isLoggedIn) { status.error.value = t('quoteRequest.errorLoginRequired'); return }
        const job = await getThemeJob(jobId).catch((failure: unknown) => {
          throw (failure as { response?: { status?: number } }).response?.status === 404 ? new ContextMismatch(t('quoteRequest.errorThemeUnavailable')) : failure
        })
        if (!alive()) return
        const result = job.results.find(result => result.resultId === job.selection.resultId)
        if (job.schemeCode !== code || !result) throw new ContextMismatch(t('quoteRequest.errorThemeUnavailable'))
        theme.value = { themeJobId: jobId, resultId: result.resultId, selectionRevision: job.selection.revision }
        themeSearchId.value = job.searchId ?? null
        themePreview.value = result.previewUrl
        if (typeof route.query.artworkJobId === 'string') {
          const artwork = await getArtworkJob(route.query.artworkJobId).catch((failure: unknown) => {
            throw (failure as { response?: { status?: number } }).response?.status === 404 ? new ContextMismatch(t('quoteRequest.errorArtworkThemeMismatch')) : failure
          })
          if (!alive()) return
          if (artwork.deliveryStatus !== 'ready' || artwork.schemeCode !== code || artwork.themeSelection.themeJobId !== jobId || artwork.themeSelection.resultId !== result.resultId || artwork.themeSelection.selectionRevision !== job.selection.revision) throw new ContextMismatch(t('quoteRequest.errorArtworkThemeMismatch'))
          artworkJobId.value = artwork.jobId
        }
      }
      context.value = loaded
    } catch (failure: unknown) {
      if (!alive()) return
      theme.value = undefined
      artworkJobId.value = undefined
      themePreview.value = ''
      const { message, retry } = failureMessage(failure)
      status.error.value = message
      retryable.value = retry
    } finally { if (alive()) loading.value = false }
  }

  /** 丢弃路由里过期的 bomRevision 后按当前版本重新加载 */
  async function refresh() {
    await router.replace({ query: { ...route.query, bomRevision: undefined } })
    status.conflict.value = false
    await load()
  }

  onMounted(load)
  onUnmounted(() => { seq++ })
  return { context, theme, themeSearchId, themePreview, standardPreview, artworkJobId, loading, retryable, reload: load, refresh }
}
