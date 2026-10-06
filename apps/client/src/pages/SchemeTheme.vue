<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { appLocale } from '@/plugins/i18n'
import { ArrowLeft, ArrowUpRight, Loader2, Sparkles, X, Plus, Palette } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import MainLayout from '@/layouts/MainLayout.vue'
import SchemeGallery from '@/features/selection/SchemeGallery.vue'
import { previewItems } from '@/features/selection/preview'
import { apiFetch } from '@/lib/api-client'
import { getThemeOffer, createThemeJob, type ThemeOffer, type ThemeJobSubmission } from '@/services/api/theme-jobs'
import { getThemeModels, type ThemeModel } from '@/services/api/theme-models'
import type { SchemeDetail } from '@/features/selection/types'
import { useAuthStore } from '@/stores/auth'
import { useCredits } from '@/composables/useCredits'
import { blockedReasonText as getBlockedReasonText } from '@/features/theme-jobs/labels'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
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
const previewVariant = Math.max(0, previewItems.findIndex(item => item.code === schemeCode))
const galleryImages = computed(() => isPreview.value ? previewItems[previewVariant]?.images ?? [] : images.value)
const activeImageIndex = computed({
  get: () => Math.max(0, galleryImages.value.findIndex(image => image.assetId === selectedAssetId.value)),
  set: (index: number) => { selectedAssetId.value = galleryImages.value[index]?.assetId ?? '' },
})
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
const keywordError = computed(() => brandKeywords.value.length > limits.value.maxKeywordCharacters ? t('schemeTheme.keywordsLimitError') : '')
const parameters = computed(() => ({
  schemeCode, sourceAssetId: selectedAssetId.value, searchId,
  input: { industryId: industryId.value, styleId: styleId.value, brandColors: [...brandColors.value], brandKeywords: brandKeywords.value },
  requestedCount: requestedCount.value, cacheMode: 'reuse' as const,
}))
const parameterKey = computed(() => JSON.stringify(parameters.value))
const canFetchOffer = computed(() => !isPreview.value && isLoggedIn.value && !!selectedAssetId.value && !!industryId.value && !!styleId.value && !invalidColors.value && !keywordError.value)
const blockedReasonText = computed(() => {
  if (!themeOffer.value || themeOffer.value.available) return ''
  return getBlockedReasonText(themeOffer.value.blockedReasons, t)
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
    if (res.available && !res.offer) offerError.value = t('schemeTheme.errorNoCost')
    return res
  } catch (error: unknown) {
    const failure = error as { data?: { error?: { reason?: string } }; response?: { status?: number }; statusCode?: number }
    if (!disposed && request === offerRequest) {
      const reason = failure.data?.error?.reason
      let message = t('schemeTheme.errorCostFetch')
      if ((failure.response?.status ?? failure.statusCode) === 429) message = t('schemeTheme.errorRateLimit')
      else if (reason === 'SOURCE_UNAVAILABLE') message = t('schemeTheme.errorImageUnavailable')
      else if (reason === 'MODEL_UNAVAILABLE') message = t('schemeTheme.errorServiceUnavailable')
      else if (reason === 'SEARCH_UNAVAILABLE') message = t('schemeTheme.errorSearchUnavailable')
      offerError.value = t('schemeTheme.errorGeneric', { message })
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

watch(appLocale, () => { if (!isPreview.value) void loadCatalog() })

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
    jobError.value = t('schemeTheme.errorExpired')
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
      jobError.value = t('schemeTheme.errorExpiredOrChanged')
    } else if (status === 402) {
      jobError.value = t('schemeTheme.errorInsufficientCredits')
      void fetchBalance()
    } else if (status === 429) {
      jobError.value = t('schemeTheme.errorRateLimitConfirm')
    } else {
      jobError.value = t('schemeTheme.errorNetworkConfirm')
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
          <RouterLink :to="{ path: detailPath, query: searchId ? { searchId } : {} }"><ArrowLeft class="mr-2 size-4" />{{ t('schemeTheme.backToScheme') }}</RouterLink>
        </Button>
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-0 flex-1 basis-64 space-y-2">
            <p class="break-words text-xs tracking-widest text-muted-foreground">{{ t('schemeTheme.pageTitle') }} {{ schemeCode }}</p>
            <h1 class="studio-title">{{ t('schemeTheme.heading') }}</h1>
            <p class="text-sm leading-relaxed text-muted-foreground">{{ t('schemeTheme.subheading') }}</p>
          </div>
          <Badge v-if="isPreview" variant="secondary">{{ t('schemeTheme.previewLabel') }}</Badge>
          <Button v-else as-child variant="outline" class="shrink-0">
            <RouterLink :to="{ path: `/schemes/${encodeURIComponent(schemeCode)}/quote`, query: { entryPoint: 'scheme_detail' } }">{{ t('schemeTheme.quoteBtn') }}<ArrowUpRight class="ml-2 size-4" /></RouterLink>
          </Button>
        </div>
      </header>

      <section v-if="schemeError" role="alert" class="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6">
        <p>{{ t('schemeTheme.schemeLoadError') }}</p>
        <Button variant="outline" @click="loadScheme">{{ t('schemeTheme.reloadScheme') }}</Button>
      </section>
      <div v-else-if="loadingScheme" class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton class="aspect-[4/3] rounded-xl" /><Skeleton class="h-96 rounded-xl" />
      </div>
      <div v-else class="grid items-start gap-8 xl:gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section :aria-label="t('schemeTheme.canvasAriaLabel')" class="min-w-0 space-y-5 lg:sticky lg:top-24">
          <h2 class="text-sm font-medium">{{ t('schemeTheme.originalImageTitle') }}</h2>
          <SchemeGallery v-model:active="activeImageIndex" :images="galleryImages" :code="schemeCode" :preview="isPreview" :variant="previewVariant" :disabled="creatingJob || confirmDialogOpen" />
          <div class="flex items-start gap-3 border-t pt-5">
            <Sparkles class="mt-0.5 size-4 shrink-0 text-primary" />
            <div class="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <h3 class="font-medium text-foreground">{{ t('schemeTheme.themeTitle') }}</h3>
              <p>{{ t('schemeTheme.themeDesc') }}</p>
              <p>{{ t('schemeTheme.themeDisclaimer') }}</p>
            </div>
          </div>
        </section>

        <aside class="studio-panel min-w-0 overflow-hidden">
          <div class="space-y-1 border-b px-5 py-5 sm:px-6">
            <h2 class="flex items-center gap-2 text-lg font-semibold"><Palette class="size-5 text-primary" />{{ t('schemeTheme.preferenceTitle') }}</h2>
            <p class="text-sm text-muted-foreground">{{ t('schemeTheme.preferenceDesc') }}</p>
          </div>
          <div v-if="!isLoggedIn && !isPreview" class="space-y-4 p-6">
            <p class="text-sm leading-relaxed text-muted-foreground">{{ t('schemeTheme.loginPrompt') }}</p>
            <Button class="w-full" @click="handleLogin">{{ t('schemeTheme.loginBtn') }}</Button>
          </div>
          <template v-else>
            <fieldset :disabled="formLocked" class="min-w-0 space-y-6 p-5 sm:p-6">
              <legend class="sr-only">{{ t('schemeTheme.preferenceTitle2') }}</legend>
              <div v-if="catalogError" role="alert" class="space-y-2 text-sm text-destructive">
                <p>{{ t('schemeTheme.optionsLoadError') }}</p>
                <Button variant="outline" size="sm" :disabled="loadingCatalog" @click="loadCatalog">{{ t('schemeTheme.retryLoadOptions') }}</Button>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div class="min-w-0 space-y-2">
                  <label for="theme-industry" class="text-sm font-medium">{{ t('schemeTheme.industryLabel') }}</label>
                  <Select v-model="industryId" :disabled="formLocked || loadingCatalog">
                    <SelectTrigger id="theme-industry" class="min-w-0"><SelectValue :placeholder="t('schemeTheme.industryPlaceholder')" /></SelectTrigger>
                    <SelectContent><SelectItem v-for="option in catalogIndustries" :key="option.id" :value="option.id">{{ option.label }}</SelectItem></SelectContent>
                  </Select>
                </div>
                <div class="min-w-0 space-y-2">
                  <label for="theme-style" class="text-sm font-medium">{{ t('schemeTheme.styleLabel') }}</label>
                  <Select v-model="styleId" :disabled="formLocked || loadingCatalog">
                    <SelectTrigger id="theme-style" class="min-w-0"><SelectValue :placeholder="t('schemeTheme.stylePlaceholder')" /></SelectTrigger>
                    <SelectContent><SelectItem v-for="option in catalogStyles" :key="option.id" :value="option.id">{{ option.label }}</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>

              <div class="space-y-3">
                <div class="flex items-center justify-between gap-2"><h3 class="text-sm font-medium">{{ t('schemeTheme.brandColorTitle') }}</h3><span class="text-xs text-muted-foreground">{{ brandColors.length }} / {{ limits.maxBrandColors }}</span></div>
                <p v-if="!brandColors.length" class="text-sm text-muted-foreground">{{ t('schemeTheme.brandColorDesc') }}</p>
                <div v-for="(color, index) in brandColors" :key="index" class="min-w-0 space-y-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <input type="color" :value="/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'" :aria-label="t('schemeTheme.brandColorAriaLabel', { index: index + 1 })" class="size-10 shrink-0 cursor-pointer rounded border bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" @input="brandColors[index] = ($event.target as HTMLInputElement).value" />
                    <Input :id="`theme-color-${index}`" v-model="brandColors[index]" :aria-label="t('schemeTheme.brandColorValueAriaLabel', { index: index + 1 })" :aria-invalid="!/^#[0-9a-f]{6}$/i.test(color)" :aria-describedby="!/^#[0-9a-f]{6}$/i.test(color) ? `theme-color-${index}-error` : undefined" class="min-w-0 flex-1 font-mono uppercase" maxlength="7" />
                    <Button variant="ghost" size="icon" class="shrink-0" :aria-label="t('schemeTheme.brandColorDeleteAriaLabel', { index: index + 1 })" @click="removeColor(index)"><X class="size-4" /></Button>
                  </div>
                  <p v-if="!/^#[0-9a-f]{6}$/i.test(color)" :id="`theme-color-${index}-error`" role="alert" class="text-sm text-destructive">{{ t('schemeTheme.brandColorError', { index: index + 1 }) }}</p>
                </div>
                <Button v-if="brandColors.length < limits.maxBrandColors" id="theme-add-color" variant="outline" size="sm" class="border-dashed" @click="addColor"><Plus class="mr-2 size-4" />{{ t('schemeTheme.addBrandColor') }}</Button>
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between gap-2"><label for="theme-keywords" class="text-sm font-medium">{{ t('schemeTheme.keywordsLabel') }} <span class="font-normal text-muted-foreground">{{ t('schemeTheme.keywordsOptional') }}</span></label><span class="text-xs tabular-nums text-muted-foreground">{{ brandKeywords.length }} / {{ limits.maxKeywordCharacters }}</span></div>
                <Textarea id="theme-keywords" v-model="brandKeywords" :placeholder="t('schemeTheme.keywordsPlaceholder')" class="resize-none" :maxlength="limits.maxKeywordCharacters" :aria-invalid="!!keywordError" :aria-describedby="keywordError ? 'theme-keywords-error' : undefined" rows="3" />
                <p v-if="keywordError" id="theme-keywords-error" role="alert" class="text-sm text-destructive">{{ keywordError }}</p>
              </div>

              <div class="space-y-3 border-t pt-5">
                <h3 class="text-sm font-medium">{{ t('schemeTheme.countLabel') }}</h3>
                <div class="grid grid-cols-4 gap-2" role="group" :aria-label="t('schemeTheme.countLabel')">
                  <Button v-for="count in limits.allowedCounts" :key="count" :variant="requestedCount === count ? 'default' : 'outline'" class="px-2" :aria-pressed="requestedCount === count" @click="requestedCount = count">{{ count }} {{ t('schemeTheme.countUnit') }}</Button>
                </div>
              </div>
            </fieldset>

            <div class="space-y-4 border-t bg-muted/30 p-5 sm:p-6">
              <div class="flex items-center justify-between text-sm text-muted-foreground"><span>{{ t('schemeTheme.balanceLabel') }}</span><span>{{ loadingCredits ? t('common.creditsLoading') : balance === null ? t('common.creditsUnknown') : `${balance} ${t('common.credits')}` }}</span></div>
              <Button v-if="!isPreview && !loadingCredits && balance === null" variant="outline" size="sm" @click="fetchBalance">{{ t('schemeTheme.retryBalance') }}</Button>
              <div aria-live="polite" aria-atomic="true" :aria-busy="loadingOffer" class="space-y-3">
                <p v-if="isPreview" class="text-sm text-muted-foreground">{{ t('schemeTheme.previewNoCredits') }}</p>
                <p v-else-if="loadingOffer" role="status" class="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 class="size-4 animate-spin" />{{ t('schemeTheme.updatingCost') }}</p>
                <div v-else-if="offerError || blockedReasonText" role="alert" class="space-y-3 text-sm text-destructive">
                  <p>{{ offerError || blockedReasonText }}</p><Button variant="outline" size="sm" :disabled="!canFetchOffer" @click="fetchOffer">{{ t('schemeTheme.retryCost') }}</Button>
                </div>
                <template v-else-if="themeOffer?.offer">
                  <p class="flex justify-between gap-2 text-sm"><span class="text-muted-foreground">{{ requestedCount }} {{ t('schemeTheme.costPerSheet', { cost: themeOffer.offer.unitCredits }) }}</span></p>
                  <div class="flex flex-wrap items-baseline justify-between gap-2"><span class="text-sm font-medium">{{ t('schemeTheme.maxLock') }}</span><p class="text-3xl font-semibold tabular-nums tracking-tight text-primary">{{ themeOffer.offer.maxCredits }} <span class="text-sm font-normal">{{ t('common.credits') }}</span></p></div>
                  <p v-if="themeOffer.offer.cacheHit" class="text-sm text-muted-foreground">{{ t('schemeTheme.reuseNotice') }}</p>
                </template>
                <p v-else class="text-sm text-muted-foreground">{{ t('schemeTheme.costPending') }}</p>
              </div>
              <div ref="confirmationTrigger">
              <Button class="w-full" size="lg" :disabled="!canFetchOffer || loadingOffer || preparingConfirmation || creatingJob" @click="prepareConfirmation">
                <Loader2 v-if="preparingConfirmation" class="mr-2 size-4 animate-spin" />
                {{ isPreview ? t('schemeTheme.submitPreview') : confirmation?.attempted && !needsNewOffer ? t('schemeTheme.submitContinue') : t('schemeTheme.submitConfirm') }}
              </Button>
              </div>
              <p v-if="jobError && !confirmDialogOpen" role="alert" class="text-sm text-destructive">{{ jobError }}</p>
              <p class="text-sm leading-6 text-muted-foreground">{{ t('schemeTheme.creditDisclaimer') }}</p>
              <details class="border-t pt-3 text-xs text-muted-foreground">
                <summary class="cursor-pointer py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{{ t('schemeTheme.modelInfo') }}</summary>
                <div class="mt-3 space-y-2 leading-relaxed">
                  <p v-if="loadingModels">{{ t('schemeTheme.modelLoading') }}</p>
                  <template v-else-if="modelsError"><p>{{ t('schemeTheme.modelUnknown') }}</p><Button size="sm" variant="outline" @click="loadModels">{{ t('schemeTheme.modelRetry') }}</Button></template>
                  <p v-else-if="themeModels.length" class="break-words">{{ t('schemeTheme.modelPrimary') }}{{ themeModels[0].model }}</p>
                  <p v-else>{{ t('schemeTheme.modelEmpty') }}</p>
                  <p>{{ t('schemeTheme.modelNote') }}</p>
                </div>
              </details>
            </div>
          </template>
        </aside>
      </div>
    </main>

    <Dialog :open="confirmDialogOpen" @update:open="setDialogOpen">
      <DialogContent class="max-h-[90dvh] overflow-y-auto" @escape-key-down="creatingJob && $event.preventDefault()" @interact-outside="creatingJob && $event.preventDefault()" @close-auto-focus="$event.preventDefault(); confirmationTrigger?.querySelector('button')?.focus()">
        <DialogHeader><DialogTitle>{{ t('schemeTheme.confirmDialogTitle') }}</DialogTitle><DialogDescription>{{ t('schemeTheme.confirmDialogDesc') }}</DialogDescription></DialogHeader>
        <div v-if="confirmation" class="space-y-4 py-2">
          <dl class="space-y-3 rounded-xl bg-muted/50 p-4 text-sm">
            <div class="flex justify-between gap-4"><dt class="text-muted-foreground">{{ t('schemeTheme.confirmCount') }}</dt><dd>{{ confirmation.payload.requestedCount }} {{ t('schemeTheme.confirmUnit') }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-muted-foreground">{{ t('schemeTheme.confirmCostPer') }}</dt><dd>{{ confirmation.quote.unitCredits }} {{ t('schemeTheme.confirmCredits') }}</dd></div>
            <div class="flex justify-between gap-4 border-t pt-3 font-medium"><dt>{{ t('schemeTheme.confirmMaxLock') }}</dt><dd class="text-primary">{{ confirmation.quote.maxCredits }} {{ t('schemeTheme.confirmCredits') }}</dd></div>
          </dl>
          <p class="text-sm leading-relaxed text-muted-foreground">{{ confirmation.quote.cacheHit ? t('schemeTheme.confirmReuseNote') : t('schemeTheme.confirmFailureNote') }}</p>
          <p v-if="jobError" role="alert" class="rounded-lg bg-destructive/10 p-3 text-sm leading-relaxed text-destructive">{{ jobError }}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="creatingJob" @click="setDialogOpen(false)">{{ t('schemeTheme.dialogBack') }}</Button>
          <Button v-if="needsNewOffer" :disabled="preparingConfirmation" @click="setDialogOpen(false); prepareConfirmation()">{{ t('schemeTheme.dialogReget') }}</Button>
          <Button v-else :disabled="creatingJob" @click="handleConfirm"><Loader2 v-if="creatingJob" class="mr-2 size-4 animate-spin" />{{ creatingJob ? t('schemeTheme.dialogGenerating') : jobError ? t('schemeTheme.dialogRetryConfirm') : t('schemeTheme.dialogConfirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </MainLayout>
</template>
