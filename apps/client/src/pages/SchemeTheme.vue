<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowUpRight, Loader2, Sparkles, X, Plus, Palette } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import MainLayout from '@/layouts/MainLayout.vue'
import BoothIllustration from '@/features/selection/BoothIllustration.vue'
import { apiFetch } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { getThemeOffer, createThemeJob, type ThemeOffer, type ThemeJobSubmission } from '@/services/api/theme-jobs'
import { getThemeModels, type ThemeModel } from '@/services/api/theme-models'
import type { SchemeDetail } from '@/features/selection/types'
import { useAuthStore } from '@/stores/auth'
import { useCredits } from '@/composables/useCredits'
import { blockedReasonText as getBlockedReasonText } from '@/features/theme-jobs/labels'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { balance, loading: loadingCredits, fetchBalance } = useCredits()
const isLoggedIn = computed(() => authStore.isLoggedIn)
const schemeCode = route.params.code as string
const searchId = typeof route.query.searchId === 'string' ? route.query.searchId : undefined
const isPreview = computed(() => route.path.startsWith('/ai-selection/preview/'))
const detailPath = computed(() => `${isPreview.value ? '/ai-selection/preview' : ''}/schemes/${encodeURIComponent(schemeCode)}`)

const schemeData = ref<SchemeDetail | null>(null)
const loadingScheme = ref(true)
const schemeError = ref(false)
const images = computed(() => schemeData.value?.images || [])
const selectedAssetId = ref('')
const selectedImageUrl = computed(() => images.value.find(image => image.assetId === selectedAssetId.value)?.url)
const selectedImageIndex = computed(() => images.value.findIndex(image => image.assetId === selectedAssetId.value) + 1)
const themeModels = ref<ThemeModel[]>([])
const loadingModels = ref(false)
const modelsError = ref(false)
type CatalogOption = { id: string; label: string }
const catalogIndustries = ref<CatalogOption[]>([])
const catalogStyles = ref<CatalogOption[]>([])
const catalogError = ref(false)
const loadingCatalog = ref(false)
const industryId = ref('')
const styleId = ref('')
const brandColors = ref<string[]>([])
const brandKeywords = ref('')
const requestedCount = ref(1)
const limits = ref<ThemeOffer['limits']>({ maxBrandColors: 3, maxKeywordCharacters: 200, allowedCounts: [1, 2, 3, 4] })
const themeOffer = ref<ThemeOffer | null>(null)
const loadingOffer = ref(false)
const offerError = ref('')
const jobError = ref('')
const needsNewOffer = ref(false)
const confirmDialogOpen = ref(false)
const preparingConfirmation = ref(false)
const creatingJob = ref(false)
const confirmationTrigger = ref<HTMLElement | null>(null)
const confirmation = ref<{ payload: ThemeJobSubmission; quote: NonNullable<ThemeOffer['offer']>; attempted: boolean } | null>(null)
const formLocked = computed(() => isPreview.value || creatingJob.value || confirmDialogOpen.value)
const invalidColors = computed(() => brandColors.value.some(color => !/^#[0-9a-f]{6}$/i.test(color)))
const keywordError = computed(() => brandKeywords.value.length > limits.value.maxKeywordCharacters ? '品牌关键词超过字数限制，请精简后重试。' : '')
const parameters = computed(() => ({
  schemeCode, sourceAssetId: selectedAssetId.value, searchId,
  input: { industryId: industryId.value, styleId: styleId.value, brandColors: [...brandColors.value], brandKeywords: brandKeywords.value },
  requestedCount: requestedCount.value, cacheMode: 'reuse' as const,
}))
const parameterKey = computed(() => JSON.stringify(parameters.value))
const canFetchOffer = computed(() => !isPreview.value && isLoggedIn.value && !!selectedAssetId.value && !!industryId.value && !!styleId.value && !invalidColors.value && !keywordError.value)
const blockedReasonText = computed(() => {
  if (!themeOffer.value || themeOffer.value.available) return ''
  return getBlockedReasonText(themeOffer.value.blockedReasons)
})
let offerRequest = 0
let offerTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false

async function loadScheme() {
  loadingScheme.value = true
  schemeError.value = false
  try {
    const res = await apiFetch<{ code: number; data: SchemeDetail }>(`/api/v1/client/schemes/${encodeURIComponent(schemeCode)}`)
    if (res.code !== 0) throw new Error('Scheme unavailable')
    schemeData.value = res.data
    if (!selectedAssetId.value) selectedAssetId.value = images.value[0]?.assetId || ''
  } catch {
    schemeError.value = true
  } finally {
    loadingScheme.value = false
  }
}

async function loadCatalog() {
  loadingCatalog.value = true
  catalogError.value = false
  try {
    const res = await apiFetch<{ code: number; data: { industries: CatalogOption[]; styles: CatalogOption[] } }>('/api/v1/client/catalog/options')
    if (res.code !== 0 || !res.data.industries.length || !res.data.styles.length) throw new Error('Options unavailable')
    catalogIndustries.value = res.data.industries
    catalogStyles.value = res.data.styles
    if (!industryId.value) industryId.value = res.data.industries[0].id
    if (!styleId.value) styleId.value = res.data.styles[0].id
  } catch {
    catalogError.value = true
  } finally {
    loadingCatalog.value = false
  }
}

async function loadModels() {
  loadingModels.value = true
  modelsError.value = false
  try { themeModels.value = await getThemeModels() }
  catch { modelsError.value = true }
  finally { loadingModels.value = false }
}

onMounted(() => {
  if (isPreview.value) { loadingScheme.value = false; return }
  void loadScheme()
  void loadCatalog()
  if (isLoggedIn.value) { void fetchBalance(); void loadModels() }
})

function invalidateOffer() {
  clearTimeout(offerTimer)
  offerRequest++
  themeOffer.value = null
  offerError.value = ''
  loadingOffer.value = false
}

watch([parameterKey, isLoggedIn], () => {
  invalidateOffer()
  confirmation.value = null
  confirmDialogOpen.value = false
  jobError.value = ''
  needsNewOffer.value = false
  if (canFetchOffer.value) {
    loadingOffer.value = true
    offerTimer = setTimeout(() => { void fetchOffer() }, 400)
  }
}, { flush: 'sync' })

onBeforeUnmount(() => { disposed = true; invalidateOffer() })

async function fetchOffer() {
  clearTimeout(offerTimer)
  if (!canFetchOffer.value || disposed) return null
  const request = ++offerRequest
  const key = parameterKey.value
  const snapshot = parameters.value
  themeOffer.value = null
  offerError.value = ''
  loadingOffer.value = true
  try {
    const res = await getThemeOffer(schemeCode, snapshot.sourceAssetId, snapshot.input, snapshot.requestedCount, searchId)
    if (disposed || request !== offerRequest || key !== parameterKey.value) return null
    themeOffer.value = res
    limits.value = res.limits
    if (res.available && !res.offer) offerError.value = '暂未取得有效积分费用，请重试。已填写内容保留在当前页面。'
    return res
  } catch (error: unknown) {
    const failure = error as { data?: { error?: { reason?: string } }; response?: { status?: number }; statusCode?: number }
    if (!disposed && request === offerRequest) {
      const reason = failure.data?.error?.reason
      let message = '积分费用获取失败，请检查网络后重试。'
      if ((failure.response?.status ?? failure.statusCode) === 429) message = '操作较频繁，请稍等一分钟再重试获取积分。'
      else if (reason === 'SOURCE_UNAVAILABLE') message = '所选原图已不可用，请选择其他视角或返回方案详情刷新。'
      else if (reason === 'MODEL_UNAVAILABLE') message = '平台生成服务暂不可用，请稍后重试。'
      else if (reason === 'SEARCH_UNAVAILABLE') message = '关联检索记录已不可用，请从方案详情重新进入。'
      offerError.value = `${message}已填写内容保留在当前页面。`
    }
    return null
  } finally {
    if (request === offerRequest) loadingOffer.value = false
  }
}

function addColor() {
  if (!formLocked.value && brandColors.value.length < limits.value.maxBrandColors) brandColors.value.push('#000000')
}

function removeColor(index: number) {
  if (formLocked.value) return
  brandColors.value.splice(index, 1)
  void nextTick(() => {
    const nextIndex = Math.min(index, brandColors.value.length - 1)
    document.getElementById(nextIndex >= 0 ? `theme-color-${nextIndex}` : 'theme-add-color')?.focus()
  })
}

function handleLogin() {
  void router.push({ path: '/auth/sign-in', query: { redirect: route.fullPath } })
}

async function prepareConfirmation() {
  if (!canFetchOffer.value || preparingConfirmation.value || creatingJob.value) return
  if (confirmation.value?.attempted && !needsNewOffer.value) { confirmDialogOpen.value = true; return }
  preparingConfirmation.value = true
  const res = await fetchOffer()
  preparingConfirmation.value = false
  if (!res?.available || !res.offer || disposed) return
  confirmation.value = { payload: { ...parameters.value, requestKey: crypto.randomUUID(), offerId: res.offer.id }, quote: { ...res.offer }, attempted: false }
  jobError.value = ''
  needsNewOffer.value = false
  confirmDialogOpen.value = true
}

async function handleConfirm() {
  const current = confirmation.value
  if (!current || creatingJob.value || needsNewOffer.value) return
  if (!current.attempted && Date.parse(current.quote.expiresAt) <= Date.now()) {
    needsNewOffer.value = true
    jobError.value = '积分确认已过期，请重新获取积分并确认。已填写内容保留在当前页面。'
    return
  }
  creatingJob.value = true
  jobError.value = ''
  current.attempted = true
  try {
    const res = await createThemeJob(current.payload)
    confirmDialogOpen.value = false
    await router.push(`/theme-jobs/${res.jobId}`)
  } catch (error: unknown) {
    const failure = error as { data?: { error?: { reason?: string } }; response?: { status?: number }; statusCode?: number }
    const reason = failure.data?.error?.reason
    const status = failure.response?.status ?? failure.statusCode
    if ((reason && ['OFFER_EXPIRED', 'OFFER_STALE', 'OFFER_MISMATCH'].includes(reason)) || status === 409) {
      needsNewOffer.value = true
      jobError.value = '积分确认已过期或生成条件已更新，请重新获取积分并确认。已填写内容保留在当前页面。'
    } else if (status === 402) {
      jobError.value = '可用积分不足，请补充积分后重试。已填写内容保留在当前页面。'
      void fetchBalance()
    } else if (status === 429) {
      jobError.value = '操作较频繁，请稍等一分钟再重试确认。已填写内容保留在当前页面。'
    } else {
      jobError.value = '暂未确认任务是否创建成功，请重试确认；将复用同一请求，避免重复创建。已填写内容保留在当前页面。'
    }
  } finally {
    creatingJob.value = false
  }
}

function setDialogOpen(open: boolean) {
  if (!creatingJob.value) confirmDialogOpen.value = open
}
</script>

<template>
  <MainLayout>
    <main id="main-content" class="studio-page">
      <header class="studio-header">
        <Button as-child variant="ghost" class="-ml-3">
          <RouterLink :to="{ path: detailPath, query: searchId ? { searchId } : {} }"><ArrowLeft class="mr-2 size-4" />返回方案详情</RouterLink>
        </Button>
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-0 flex-1 basis-64 space-y-2">
            <p class="break-words text-xs tracking-widest text-muted-foreground">品牌视觉工作区 · 方案 {{ schemeCode }}</p>
            <h1 class="studio-title">让展台呈现您的品牌</h1>
            <p class="text-sm leading-relaxed text-muted-foreground">选择原图，调整品牌色与视觉偏好，再确认积分生成主题效果。</p>
          </div>
          <Badge v-if="isPreview" variant="secondary">静态示例 · 不可提交</Badge>
          <Button v-else as-child variant="outline" class="shrink-0">
            <RouterLink :to="{ path: `/schemes/${encodeURIComponent(schemeCode)}/quote`, query: { entryPoint: 'scheme_detail' } }">申请展台报价<ArrowUpRight class="ml-2 size-4" /></RouterLink>
          </Button>
        </div>
      </header>

      <section v-if="schemeError" role="alert" class="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6">
        <p>方案加载失败，请检查网络后重试。已填写内容保留在当前页面。</p>
        <Button variant="outline" @click="loadScheme">重新加载方案</Button>
      </section>
      <div v-else-if="loadingScheme" class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton class="aspect-[4/3] rounded-xl" /><Skeleton class="h-96 rounded-xl" />
      </div>
      <div v-else class="grid items-start gap-8 xl:gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="原始方案画布" class="min-w-0 space-y-5 lg:sticky lg:top-24">
          <div class="flex items-center justify-between gap-3 text-sm">
            <h2 class="font-medium">原始效果图</h2>
            <span class="text-muted-foreground">{{ images.length ? `视角 ${selectedImageIndex} / ${images.length}` : '暂无原图' }}</span>
          </div>
          <div class="relative flex aspect-video items-center justify-center overflow-hidden rounded-md bg-image-surface">
            <img v-if="selectedImageUrl" :src="selectedImageUrl" class="size-full object-contain" :alt="`原始方案 · 视角 ${selectedImageIndex}`" />
            <div v-else class="space-y-3 text-center text-muted-foreground">
              <BoothIllustration class="mx-auto size-32 opacity-40" />
              <p class="text-sm">{{ isPreview ? '静态示例不提供真实生成' : '该方案暂无可用原图' }}</p>
            </div>
            <span class="absolute left-4 top-4 rounded-full border bg-background/90 px-3 py-1 text-xs">原图 · 未调整</span>
          </div>
          <div v-if="images.length > 1" class="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-label="选择原图视角">
            <button v-for="(image, index) in images" :key="image.assetId" type="button"
              :class="cn('min-w-0 overflow-hidden rounded-lg border-2 bg-muted/30 p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60', selectedAssetId === image.assetId ? 'border-primary' : 'border-transparent hover:border-border')"
              :aria-label="`选择视角 ${index + 1}`" :aria-pressed="selectedAssetId === image.assetId" :disabled="formLocked" @click="selectedAssetId = image.assetId">
              <img :src="image.thumbnailUrl || image.url" class="aspect-video w-full object-contain" :alt="`视角 ${index + 1}`" />
              <span class="block py-1 text-xs">视角 {{ index + 1 }}<span v-if="selectedAssetId === image.assetId" class="block font-medium">当前原图</span></span>
            </button>
          </div>
          <div class="flex items-start gap-3 border-t pt-5">
            <Sparkles class="mt-0.5 size-4 shrink-0 text-primary" />
            <div class="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <h3 class="font-medium text-foreground">焕新品牌表达，延续空间设计</h3>
              <p>围绕品牌色、海报与展示画面调整视觉，尽量保留原方案结构与材质。可编辑范围由方案决定，不支持自定义框选。</p>
              <p>AI 效果仅供方案沟通；也可直接使用标准方案申请展台报价。</p>
            </div>
          </div>
        </section>

        <aside class="studio-panel min-w-0 overflow-hidden">
          <div class="space-y-1 border-b px-5 py-5 sm:px-6">
            <h2 class="flex items-center gap-2 text-lg font-semibold"><Palette class="size-5 text-primary" />品牌与视觉偏好</h2>
            <p class="text-sm text-muted-foreground">从品牌出发，探索新的展示风格。</p>
          </div>
          <div v-if="!isLoggedIn && !isPreview" class="space-y-4 p-6">
            <p class="text-sm leading-relaxed text-muted-foreground">登录后设置品牌偏好、查看积分并生成主题效果。</p>
            <Button class="w-full" @click="handleLogin">登录以继续</Button>
          </div>
          <template v-else>
            <fieldset :disabled="formLocked" class="min-w-0 space-y-6 p-5 sm:p-6">
              <legend class="sr-only">品牌与视觉偏好</legend>
              <div v-if="catalogError" role="alert" class="space-y-2 text-sm text-destructive">
                <p>行业与风格加载失败，已填写内容保留在当前页面。</p>
                <Button variant="outline" size="sm" :disabled="loadingCatalog" @click="loadCatalog">重试加载选项</Button>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div class="min-w-0 space-y-2">
                  <label for="theme-industry" class="text-sm font-medium">行业</label>
                  <Select v-model="industryId" :disabled="formLocked || loadingCatalog">
                    <SelectTrigger id="theme-industry" class="min-w-0"><SelectValue placeholder="选择行业" /></SelectTrigger>
                    <SelectContent><SelectItem v-for="option in catalogIndustries" :key="option.id" :value="option.id">{{ option.label }}</SelectItem></SelectContent>
                  </Select>
                </div>
                <div class="min-w-0 space-y-2">
                  <label for="theme-style" class="text-sm font-medium">视觉风格</label>
                  <Select v-model="styleId" :disabled="formLocked || loadingCatalog">
                    <SelectTrigger id="theme-style" class="min-w-0"><SelectValue placeholder="选择风格" /></SelectTrigger>
                    <SelectContent><SelectItem v-for="option in catalogStyles" :key="option.id" :value="option.id">{{ option.label }}</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>

              <div class="space-y-3">
                <div class="flex items-center justify-between gap-2"><h3 class="text-sm font-medium">品牌色</h3><span class="text-xs text-muted-foreground">{{ brandColors.length }} / {{ limits.maxBrandColors }}</span></div>
                <p v-if="!brandColors.length" class="text-sm text-muted-foreground">添加品牌主色，让视觉更贴近您的品牌。</p>
                <div v-for="(color, index) in brandColors" :key="index" class="min-w-0 space-y-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <input type="color" :value="/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'" :aria-label="`选择品牌色 ${index + 1}`" class="size-10 shrink-0 cursor-pointer rounded border bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @input="brandColors[index] = ($event.target as HTMLInputElement).value" />
                    <Input :id="`theme-color-${index}`" v-model="brandColors[index]" :aria-label="`品牌色 ${index + 1} 色值`" :aria-invalid="!/^#[0-9a-f]{6}$/i.test(color)" :aria-describedby="!/^#[0-9a-f]{6}$/i.test(color) ? `theme-color-${index}-error` : undefined" class="min-w-0 flex-1 font-mono uppercase" maxlength="7" />
                    <Button variant="ghost" size="icon" class="shrink-0" :aria-label="`删除品牌色 ${index + 1}`" @click="removeColor(index)"><X class="size-4" /></Button>
                  </div>
                  <p v-if="!/^#[0-9a-f]{6}$/i.test(color)" :id="`theme-color-${index}-error`" role="alert" class="text-sm text-destructive">品牌色 {{ index + 1 }} 请填写完整的六位色值，例如 #1A6B52。</p>
                </div>
                <Button v-if="brandColors.length < limits.maxBrandColors" id="theme-add-color" variant="outline" size="sm" class="border-dashed" @click="addColor"><Plus class="mr-2 size-4" />添加品牌色</Button>
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between gap-2"><label for="theme-keywords" class="text-sm font-medium">品牌关键词 <span class="font-normal text-muted-foreground">选填</span></label><span class="text-xs tabular-nums text-muted-foreground">{{ brandKeywords.length }} / {{ limits.maxKeywordCharacters }}</span></div>
                <Textarea id="theme-keywords" v-model="brandKeywords" placeholder="例如：智能科技、绿色环保、简洁现代" class="resize-none" :maxlength="limits.maxKeywordCharacters" :aria-invalid="!!keywordError" :aria-describedby="keywordError ? 'theme-keywords-error' : undefined" rows="3" />
                <p v-if="keywordError" id="theme-keywords-error" role="alert" class="text-sm text-destructive">{{ keywordError }}</p>
              </div>

              <div class="space-y-3 border-t pt-5">
                <h3 class="text-sm font-medium">生成数量</h3>
                <div class="grid grid-cols-4 gap-2" role="group" aria-label="生成数量">
                  <Button v-for="count in limits.allowedCounts" :key="count" :variant="requestedCount === count ? 'default' : 'outline'" class="px-2" :aria-pressed="requestedCount === count" @click="requestedCount = count">{{ count }} 张</Button>
                </div>
              </div>
            </fieldset>

            <div class="space-y-4 border-t bg-muted/30 p-5 sm:p-6">
              <div class="flex items-center justify-between text-sm text-muted-foreground"><span>可用积分</span><span>{{ loadingCredits ? '读取中…' : balance === null ? '暂未获取' : `${balance} 积分` }}</span></div>
              <Button v-if="!isPreview && !loadingCredits && balance === null" variant="outline" size="sm" @click="fetchBalance">重试查询余额</Button>
              <div aria-live="polite" aria-atomic="true" :aria-busy="loadingOffer" class="space-y-3">
                <p v-if="isPreview" class="text-sm text-muted-foreground">示例模式不获取积分费用。</p>
                <p v-else-if="loadingOffer" role="status" class="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="size-4 animate-spin" />正在更新积分费用…</p>
                <div v-else-if="offerError || blockedReasonText" role="alert" class="space-y-3 text-sm text-destructive">
                  <p>{{ offerError || blockedReasonText }}</p><Button variant="outline" size="sm" :disabled="!canFetchOffer" @click="fetchOffer">重试获取积分</Button>
                </div>
                <template v-else-if="themeOffer?.offer">
                  <p class="flex justify-between gap-2 text-sm"><span class="text-muted-foreground">{{ requestedCount }} 张 · 单张 {{ themeOffer.offer.unitCredits }} 积分</span></p>
                  <div class="flex flex-wrap items-baseline justify-between gap-2"><span class="text-sm font-medium">最高锁定积分</span><p class="text-3xl font-semibold tabular-nums tracking-tight text-primary">{{ themeOffer.offer.maxCredits }} <span class="text-sm font-normal">积分</span></p></div>
                  <p v-if="themeOffer.offer.cacheHit" class="text-sm text-muted-foreground">已有相同条件的生成结果，本次复用不扣积分。</p>
                </template>
                <p v-else class="text-sm text-muted-foreground">费用待更新，请先选择原图并完善视觉偏好。</p>
              </div>
              <div ref="confirmationTrigger">
              <Button class="w-full" size="lg" :disabled="!canFetchOffer || loadingOffer || preparingConfirmation || creatingJob" @click="prepareConfirmation">
                <Loader2 v-if="preparingConfirmation" class="mr-2 size-4 animate-spin" />
                {{ isPreview ? '示例模式 · 不可提交' : confirmation?.attempted && !needsNewOffer ? '继续确认本次生成' : '确认积分并生成' }}
              </Button>
              </div>
              <p v-if="jobError && !confirmDialogOpen" role="alert" class="text-sm text-destructive">{{ jobError }}</p>
              <p class="text-sm leading-6 text-muted-foreground">按实际成功张数结算，未成功部分释放积分。此处为 AI 生成积分，与展台服务报价无关。</p>
              <details class="border-t pt-3 text-xs text-muted-foreground">
                <summary class="cursor-pointer py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">模型由平台配置 · 查看说明</summary>
                <div class="mt-3 space-y-2 leading-relaxed">
                  <p v-if="loadingModels">正在读取平台配置…</p>
                  <template v-else-if="modelsError"><p>平台模型信息暂未获取。</p><Button size="sm" variant="outline" @click="loadModels">重试读取模型</Button></template>
                  <p v-else-if="themeModels.length" class="break-words">当前平台首选模型：{{ themeModels[0].model }}</p>
                  <p v-else>当前暂无可展示的模型配置。</p>
                  <p>平台按配置顺序调用模型，必要时自动回退。首选模型不代表最终执行模型；积分以本次确认为准。</p>
                </div>
              </details>
            </div>
          </template>
        </aside>
      </div>
    </main>

    <Dialog :open="confirmDialogOpen" @update:open="setDialogOpen">
      <DialogContent class="max-h-[90dvh] overflow-y-auto" @escape-key-down="creatingJob && $event.preventDefault()" @interact-outside="creatingJob && $event.preventDefault()" @close-auto-focus="$event.preventDefault(); confirmationTrigger?.querySelector('button')?.focus()">
        <DialogHeader><DialogTitle>确认积分并生成</DialogTitle><DialogDescription>请核对本次生成数量与积分。确认后将锁定积分，按实际成功张数结算。</DialogDescription></DialogHeader>
        <div v-if="confirmation" class="space-y-4 py-2">
          <dl class="space-y-3 rounded-xl bg-muted/50 p-4 text-sm">
            <div class="flex justify-between gap-4"><dt class="text-muted-foreground">生成数量</dt><dd>{{ confirmation.payload.requestedCount }} 张</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-muted-foreground">单张积分</dt><dd>{{ confirmation.quote.unitCredits }} 积分</dd></div>
            <div class="flex justify-between gap-4 border-t pt-3 font-medium"><dt>最高锁定积分</dt><dd class="text-primary">{{ confirmation.quote.maxCredits }} 积分</dd></div>
          </dl>
          <p class="text-sm leading-relaxed text-muted-foreground">{{ confirmation.quote.cacheHit ? '将复用已有结果，本次不扣积分。' : '生成失败的张数将在任务结算后释放对应积分。' }}</p>
          <p v-if="jobError" role="alert" class="rounded-lg bg-destructive/10 p-3 text-sm leading-relaxed text-destructive">{{ jobError }}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="creatingJob" @click="setDialogOpen(false)">返回调整</Button>
          <Button v-if="needsNewOffer" :disabled="preparingConfirmation" @click="setDialogOpen(false); prepareConfirmation()">重新获取积分并确认</Button>
          <Button v-else :disabled="creatingJob" @click="handleConfirm"><Loader2 v-if="creatingJob" class="mr-2 size-4 animate-spin" />{{ creatingJob ? '正在创建任务…' : jobError ? '重试确认生成' : '确认生成' }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </MainLayout>
</template>
