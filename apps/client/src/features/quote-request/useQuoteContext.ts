import { onMounted, ref, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { getQuoteContext, type QuoteContext, type QuoteRequest } from '@/services/api/quote-requests'
import { getThemeJob } from '@/services/api/theme-jobs'
import { getArtworkJob } from '@/services/api/artwork-jobs'
import { getSchemeImages } from '@/services/api/selection'

/**
 * 报价上下文：方案当前版本，以及路由带入的主题结果与素材任务（themeJobId / artworkJobId）。
 * 主题、素材必须与当前方案和已选主题版本一致才会随申请提交；路由带的 bomRevision 落后于当前版本时标记冲突，需刷新确认。
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

  async function load() {
    if (!enabled) { loading.value = false; return }
    loading.value = true
    status.error.value = ''
    theme.value = undefined
    artworkJobId.value = undefined
    themeSearchId.value = undefined
    try {
      context.value = await getQuoteContext(code)
      void getSchemeImages(code).then(images => { standardPreview.value = images[0]?.url ?? '' }).catch(() => { standardPreview.value = '' })
      if (typeof route.query.bomRevision === 'string' && Number(route.query.bomRevision) !== context.value.bomRevision) {
        status.conflict.value = true
        status.error.value = t('quoteRequest.errorBomStale')
      }
      const jobId = route.query.themeJobId
      if (route.query.artworkJobId && typeof jobId !== 'string') throw new Error(t('quoteRequest.errorArtworkNoTheme'))
      if (typeof jobId === 'string') {
        if (!auth.isLoggedIn) { context.value = null; status.error.value = t('quoteRequest.errorLoginRequired'); return }
        const job = await getThemeJob(jobId)
        const result = job.results.find(result => result.resultId === job.selection.resultId)
        if (job.schemeCode !== code || !result) throw new Error(t('quoteRequest.errorThemeUnavailable'))
        theme.value = { themeJobId: jobId, resultId: result.resultId, selectionRevision: job.selection.revision }
        themeSearchId.value = job.searchId ?? null
        themePreview.value = result.previewUrl
        if (typeof route.query.artworkJobId === 'string') {
          const artwork = await getArtworkJob(route.query.artworkJobId)
          if (artwork.deliveryStatus !== 'ready' || artwork.schemeCode !== code || artwork.themeSelection.themeJobId !== jobId || artwork.themeSelection.resultId !== result.resultId || artwork.themeSelection.selectionRevision !== job.selection.revision) throw new Error(t('quoteRequest.errorArtworkThemeMismatch'))
          artworkJobId.value = artwork.jobId
        }
      }
    } catch { context.value = null; status.error.value = t('quoteRequest.errorSchemeChanged') }
    finally { loading.value = false }
  }

  /** 丢弃路由里过期的 bomRevision 后按当前版本重新加载 */
  async function refresh() {
    await router.replace({ query: { ...route.query, bomRevision: undefined } })
    status.conflict.value = false
    await load()
  }

  onMounted(load)
  return { context, theme, themeSearchId, themePreview, standardPreview, artworkJobId, loading, refresh }
}
