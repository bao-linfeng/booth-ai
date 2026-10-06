<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ArrowRight, Loader2, CheckCircle2, CircleAlert, ImageIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import StatusBadge from '@/components/StatusBadge.vue'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import MainLayout from '@/layouts/MainLayout.vue'
import { cn } from '@/lib/utils'
import { useAsyncJob } from '@/composables/useAsyncJob'
import { createThemeJobEventsTicket, getThemeJob, openThemeJobEvents, saveThemeSelection, type ThemeJob } from '@/services/api/theme-jobs'
import { failureReasonText, phaseText as getPhaseText, getThemeJobStatusLabels } from '@/features/theme-jobs/labels'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const themeJobStatusLabels = getThemeJobStatusLabels(t)
const jobId = route.params.jobId as string

const jobData = ref<ThemeJob | null>(null)
const loading = ref(true)
const error = ref(false)
const savingSelection = ref(false)
const refreshingSelection = ref(false)
const selectionUncertain = ref(false)
const selectionNotice = ref<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
const savingResultNumber = ref(0)
let disposed = false

const isPending = computed(() => {
  if (!jobData.value) return false
  return ['pending', 'queued', 'running', 'settling'].includes(jobData.value.status)
})

const asyncJob = useAsyncJob<ThemeJob>({
  fetch: getThemeJob,
  createEventsTicket: createThemeJobEventsTicket,
  openEvents: openThemeJobEvents,
  isPending: data => ['pending', 'queued', 'running', 'settling'].includes(data.status),
  onData: data => {
    error.value = false
    if (jobData.value && data.selection.revision < jobData.value.selection.revision) {
      data.selection = jobData.value.selection
    }
    jobData.value = data
  },
  onError: (_error, initial) => {
    console.error('Failed to load theme job', _error)
    if (initial) error.value = true
  },
  reconnectDelay: (_error, initial) => initial ? null : 3000,
})

function fetchJob(initial = false) {
  if (initial) loading.value = true
  return asyncJob.refresh(initial).finally(() => {
    if (initial) loading.value = false
  })
}

onMounted(() => {
  loading.value = true
  void asyncJob.start(jobId).finally(() => { loading.value = false })
})
onUnmounted(() => { disposed = true })

const isFinished = computed(() => {
  if (!jobData.value) return false
  return ['succeeded', 'partially_succeeded', 'failed'].includes(jobData.value.status)
})

const isFailed = computed(() => jobData.value?.status === 'failed')
const isPartial = computed(() => jobData.value?.status === 'partially_succeeded')

const previewResultId = ref<string | null>(null)
const imagePreviewOpen = ref(false)
const activeResultIndex = computed(() => Math.max(0, jobData.value?.results.findIndex(result => result.resultId === previewResultId.value) ?? 0))
const activeResult = computed(() => jobData.value?.results[activeResultIndex.value] ?? null)
const selectedResultId = computed(() => jobData.value?.selection.resultId)
const selectedResultIndex = computed(() => jobData.value?.results.findIndex(result => result.resultId === selectedResultId.value) ?? -1)
const selectedResult = computed(() => jobData.value?.results[selectedResultIndex.value] ?? null)
const canSelect = computed(() => !!jobData.value && ['succeeded', 'partially_succeeded'].includes(jobData.value.status))
const selectionBusy = computed(() => savingSelection.value || refreshingSelection.value)
const canContinue = computed(() => canSelect.value && !!selectedResult.value && !selectionBusy.value && !selectionUncertain.value)

function selectionSummary() {
  if (!canSelect.value) return t('themeJob.errorNotSelectable')
  if (selectedResult.value) return t('themeJob.errorAlreadySelected', { n: selectedResultIndex.value + 1 })
  if (selectedResultId.value) return t('themeJob.errorSelectedUnavailable')
  return t('themeJob.errorNoSelection')
}

async function refreshSelection(conflict = false) {
  if (refreshingSelection.value) return
  refreshingSelection.value = true
  const refreshed = await fetchJob()
  if (!disposed) {
    selectionUncertain.value = !refreshed
    selectionNotice.value = refreshed
      ? { tone: conflict ? 'warning' : 'success', message: `${conflict ? t('themeJob.errorSelectionChanged') : t('themeJob.errorRefreshed')}${selectionSummary()}` }
      : { tone: 'error', message: `${conflict ? t('themeJob.errorSelectionChangedShort') : ''}${t('themeJob.errorRefreshFailed')}` }
  }
  refreshingSelection.value = false
}

async function handleSelectResult(resultId: string) {
  if (!jobData.value || !canSelect.value || selectionBusy.value || selectionUncertain.value || resultId === selectedResultId.value) return
  savingSelection.value = true
  savingResultNumber.value = jobData.value.results.findIndex(result => result.resultId === resultId) + 1
  selectionNotice.value = null
  try {
    const res = await saveThemeSelection(jobId, resultId, jobData.value.selection.revision)
    if (disposed) return
    if (res.revision >= jobData.value.selection.revision) {
      jobData.value.selection = { resultId: res.resultId, revision: res.revision }
    }
    selectionNotice.value = { tone: 'success', message: t('themeJob.savingSuccess', { summary: selectionSummary() }) }
  } catch (e: unknown) {
    if (disposed) return
    selectionUncertain.value = true
    const status = (e as { response?: { status?: number }; statusCode?: number } | null)?.response?.status
      ?? (e as { statusCode?: number } | null)?.statusCode
    if (status === 409) await refreshSelection(true)
    else selectionNotice.value = { tone: 'error', message: t('themeJob.errorSaveFailed') }
  } finally {
    savingSelection.value = false
  }
}

function continueWithSelection(destination: 'quote' | 'artwork') {
  if (!canContinue.value || !jobData.value) return
  void router.push({ path: `/schemes/${encodeURIComponent(jobData.value.schemeCode)}/${destination}`, query: { themeJobId: jobId } })
}

const statusText = computed(() => {
  if (!jobData.value) return t('common.loading')
  return themeJobStatusLabels[jobData.value.status]
})

const phaseText = computed(() => getPhaseText(jobData.value, t))

const failureReason = computed(() => failureReasonText(jobData.value?.failure?.reason, t))

</script>

<template>
  <MainLayout>
    <main id="main-content" class="studio-page">
      <header class="studio-header">
        <Button variant="ghost" class="-ml-3" @click="router.back()">
          <ArrowLeft class="mr-2 size-4" />{{ t('themeJob.back') }}
        </Button>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 space-y-2">
            <p v-if="jobData" class="break-all text-sm text-muted-foreground">{{ t('themeJob.schemeLabel') }} {{ jobData.schemeCode }}</p>
            <h1 class="studio-title">{{ t('themeJob.pageTitle') }}</h1>
            <p class="text-sm text-muted-foreground">{{ t('themeJob.pageDesc') }}</p>
          </div>
          <div v-if="jobData" class="flex flex-wrap gap-2">
            <StatusBadge domain="job" :status="jobData.status" :label="statusText" class="gap-1.5 py-1">
              <Loader2 v-if="isPending" class="size-3.5 animate-spin" />
              <CircleAlert v-else-if="isFailed || isPartial" class="size-3.5" />
              <CheckCircle2 v-else class="size-3.5" />
            </StatusBadge>
            <Badge v-if="jobData.credits.status === 'settled'" variant="secondary">{{ t('themeJob.creditsSettled') }}</Badge>
          </div>
        </div>
        <details class="text-xs text-muted-foreground">
          <summary class="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{{ t('themeJob.jobInfo') }}</summary>
          <p class="mt-2 break-all font-mono">{{ t('themeJob.jobId') }}{{ jobId }}</p>
        </details>
      </header>

      <div v-if="loading" class="space-y-4" role="status">
        <p class="text-sm text-muted-foreground">{{ t('themeJob.jobLoading') }}</p>
        <Skeleton class="aspect-video w-full rounded-xl" />
      </div>

      <div v-else-if="error" role="alert" class="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-destructive sm:p-12">
        <CircleAlert class="size-8 mx-auto mb-4 opacity-50" />
        <h2 class="text-lg font-semibold mb-2">{{ t('themeJob.jobLoadError') }}</h2>
        <p class="text-sm">{{ t('themeJob.jobLoadErrorDesc') }}</p>
        <div class="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="outline" @click="fetchJob(true)">{{ t('themeJob.jobReload') }}</Button>
          <Button variant="ghost" @click="router.push('/ai-selection')">{{ t('themeJob.backToSelection') }}</Button>
        </div>
      </div>

      <template v-else-if="jobData">
        <div v-if="selectionNotice" :role="selectionNotice.tone === 'error' ? 'alert' : 'status'" :class="cn('space-y-3 rounded-lg border p-4 text-sm', selectionNotice.tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : selectionNotice.tone === 'warning' ? 'border-warning/30 bg-warning/5 text-warning' : 'border-success/30 bg-success/5 text-success')">
          <p>{{ selectionNotice.message }}</p>
          <Button v-if="selectionUncertain" variant="outline" :disabled="selectionBusy" @click="refreshSelection()">
            <Loader2 v-if="refreshingSelection" class="mr-2 size-4 animate-spin" />
            {{ refreshingSelection ? t('themeJob.refreshing') : t('themeJob.refreshSelection') }}
          </Button>
        </div>
        <!-- 进度视图 -->
        <Card v-if="isPending" class="border-dashed">
          <CardContent class="flex min-h-[360px] flex-col items-center justify-center space-y-6 p-6 sm:p-12" role="status">
            <Loader2 class="size-10 animate-spin text-primary" />
            <div class="text-center space-y-2">
              <h2 class="text-lg font-medium">{{ phaseText }}</h2>
              <p class="text-sm text-muted-foreground">{{ t('themeJob.processingNotice') }}</p>
            </div>
            <div class="grid w-full max-w-md grid-cols-2 gap-4 opacity-50" aria-hidden="true">
              <Skeleton class="aspect-video w-full rounded-lg" />
              <Skeleton class="aspect-video w-full rounded-lg" />
            </div>
          </CardContent>
        </Card>

        <!-- 失败视图 -->
        <Card v-else-if="isFailed" class="border-destructive/30">
          <CardContent class="flex flex-col items-center justify-center space-y-6 p-6 sm:p-12">
            <div class="rounded-full bg-destructive/10 p-4">
              <CircleAlert class="size-8 text-destructive" />
            </div>
            <div class="text-center space-y-2">
              <h2 class="text-lg font-semibold">{{ t('themeJob.resultFailed') }}</h2>
              <p class="text-sm text-muted-foreground">{{ failureReason }}</p>
              <p v-if="jobData.credits.status === 'released'" class="pt-2 text-sm text-muted-foreground">{{ t('themeJob.creditsReleased') }}</p>
            </div>
            <div class="flex flex-wrap justify-center gap-4 pt-4">
              <Button variant="outline" as-child>
                <RouterLink :to="{ path: `/schemes/${encodeURIComponent(jobData.schemeCode)}`, query: jobData.searchId ? { searchId: jobData.searchId } : {} }">{{ t('themeJob.useOriginal') }}</RouterLink>
              </Button>
              <Button v-if="jobData.failure?.retryable" as-child>
                <RouterLink :to="{ path: `/schemes/${encodeURIComponent(jobData.schemeCode)}/theme`, query: jobData.searchId ? { searchId: jobData.searchId } : {} }">{{ t('themeJob.regenerate') }}</RouterLink>
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- 成功/部分成功视图 -->
        <div v-else-if="isFinished && jobData.results.length > 0" class="space-y-8">
          <div v-if="isPartial" class="flex items-start gap-3 rounded-lg bg-warning/10 p-4 text-warning">
            <CircleAlert class="size-5 shrink-0 mt-0.5" />
            <div>
              <h3 class="font-medium">{{ t('themeJob.partialSuccess') }}</h3>
              <p class="text-sm mt-1">{{ t('themeJob.partialSuccessCount', { success: jobData.usableCount, total: jobData.requestedCount }) }}</p>
            </div>
          </div>

          <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section class="min-w-0 space-y-4" aria-labelledby="preview-heading">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 id="preview-heading" class="text-lg font-semibold" aria-live="polite">{{ t('themeJob.previewingN', { n: activeResultIndex + 1, total: jobData.results.length }) }}</h2>
                <Badge v-if="activeResult?.resultId === selectedResultId && !selectionUncertain" variant="outline" class="gap-1 border-success/30 text-success"><CheckCircle2 class="size-3.5" />{{ t('themeJob.selectedEffect') }}</Badge>
                <Badge v-else variant="secondary">{{ t('themeJob.previewOnly') }}</Badge>
              </div>
              <button v-if="activeResult" type="button" class="aspect-video w-full overflow-hidden rounded-md bg-image-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" :aria-label="t('themeJob.enlargeAriaLabel', { n: activeResultIndex + 1 })" @click="imagePreviewOpen = true">
                <img :src="activeResult.previewUrl" :alt="t('themeJob.imageAlt', { n: activeResultIndex + 1 })" class="h-full w-full object-contain" />
              </button>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" :aria-label="t('themeJob.navAriaLabel')">
                <button
                  v-for="(result, index) in jobData.results" :key="result.resultId"
                  type="button"
                  :aria-label="`${t('themeJob.previewThumbnailAriaLabel', { n: index + 1 })}${result.resultId === selectedResultId && !selectionUncertain ? t('themeJob.selectedAriaLabel') : ''}`"
                  :aria-pressed="activeResultIndex === index"
                  :class="cn('min-w-0 overflow-hidden rounded-lg border bg-background text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background', activeResultIndex === index ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50')"
                  @click="previewResultId = result.resultId"
                >
                  <img :src="result.previewUrl" alt="" class="aspect-video w-full bg-muted/40 object-contain" />
                  <span class="flex flex-wrap items-center justify-between gap-1 p-2 text-xs">
                    <span>{{ t('themeJob.thumbnailLabel', { n: index + 1 }) }}</span>
                    <span v-if="result.resultId === selectedResultId && !selectionUncertain" class="flex items-center gap-1 text-success"><CheckCircle2 class="size-3" />{{ t('themeJob.thumbnailSelected') }}</span>
                    <span v-else-if="activeResultIndex === index" class="text-primary">{{ t('themeJob.thumbnailPreviewing') }}</span>
                  </span>
                </button>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p class="text-sm text-muted-foreground">{{ t('themeJob.switchNote') }}</p>
                <Button
                  v-if="activeResult && (selectedResultId !== activeResult.resultId || selectionUncertain || savingSelection)"
                  :variant="selectedResult ? 'outline' : 'default'"
                  :disabled="selectionBusy || selectionUncertain"
                  class="h-auto min-h-10 whitespace-normal"
                  @click="handleSelectResult(activeResult.resultId)"
                >
                  <Loader2 v-if="selectionBusy" class="mr-2 size-4 shrink-0 animate-spin" />
                  {{ savingSelection ? t('themeJob.savingN', { n: savingResultNumber }) : t('themeJob.selectEffect') }}
                </Button>
                <p v-else class="flex items-center gap-1.5 text-sm text-success"><CheckCircle2 class="size-4" />{{ t('themeJob.effectSelected') }}</p>
              </div>
              <details class="border-t py-5">
                <summary class="flex cursor-pointer items-center gap-2 rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ImageIcon class="size-4" />{{ t('themeJob.compareTitle') }}</summary>
                <img :src="jobData.original.previewUrl" :alt="t('themeJob.compareOriginalAlt')" class="mt-4 aspect-video w-full rounded-lg bg-muted/40 object-contain" />
              </details>
            </section>

            <aside class="studio-panel min-w-0 space-y-5 p-6 lg:sticky lg:top-24" aria-labelledby="selected-heading" :aria-busy="selectionBusy">
              <div class="space-y-2">
                <h2 id="selected-heading" class="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 class="size-5 text-primary" />{{ t('themeJob.selectedTitle') }}</h2>
                <p class="text-sm text-muted-foreground">{{ t('themeJob.selectedDesc') }}</p>
              </div>
              <div v-if="selectionUncertain" class="space-y-2 rounded-lg bg-warning/10 p-4 text-sm text-warning">
                <p class="font-medium">{{ t('themeJob.pendingTitle') }}</p>
                <p>{{ t('themeJob.pendingDesc') }}</p>
              </div>
              <div v-else-if="selectedResult" class="space-y-3">
                <img :src="selectedResult.previewUrl" :alt="t('themeJob.imageAlt', { n: selectedResultIndex + 1 })" class="aspect-video w-full rounded-lg border bg-muted/40 object-contain" />
                <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span class="flex items-center gap-1.5 font-medium text-success"><CheckCircle2 class="size-4" />{{ t('themeJob.selectedN', { n: selectedResultIndex + 1 }) }}</span>
                  <Button v-if="activeResult?.resultId !== selectedResultId" variant="ghost" size="sm" @click="previewResultId = selectedResultId ?? null">{{ t('themeJob.previewSelected') }}</Button>
                </div>
                <p v-if="activeResult?.resultId !== selectedResultId" class="text-sm text-muted-foreground">{{ t('themeJob.previewingDifferent', { preview: activeResultIndex + 1, selected: selectedResultIndex + 1 }) }}</p>
              </div>
              <div v-else class="space-y-2 rounded-lg border border-dashed p-5 text-sm">
                <p class="font-medium">{{ selectedResultId ? t('themeJob.unavailableTitle') : t('themeJob.noSelectionTitle') }}</p>
                <p class="text-muted-foreground">{{ t('themeJob.noSelectionHint') }}</p>
              </div>
              <div class="space-y-3 border-t pt-5">
                <Button class="h-auto min-h-11 w-full whitespace-normal" :disabled="!canContinue" @click="continueWithSelection('quote')">{{ t('themeJob.quoteWithSelected') }}<ArrowRight class="ml-2 size-4 shrink-0" /></Button>
                <Button variant="outline" class="h-auto min-h-11 w-full whitespace-normal" :disabled="!canContinue" @click="continueWithSelection('artwork')">{{ t('themeJob.artworkWithSelected') }}</Button>
                <p class="text-xs leading-relaxed text-muted-foreground">{{ t('themeJob.artworkNote') }}</p>
              </div>
              <Button variant="ghost" class="h-auto min-h-10 w-full whitespace-normal" as-child>
                <RouterLink :to="{ path: `/schemes/${encodeURIComponent(jobData.schemeCode)}`, query: jobData.searchId ? { searchId: jobData.searchId } : {} }">{{ t('themeJob.continueOriginal') }}</RouterLink>
              </Button>
            </aside>
          </div>
        </div>
        <div v-else-if="isFinished" class="space-y-3 rounded-lg border p-6" role="status">
          <h2 class="font-semibold">{{ t('themeJob.noEffectsTitle') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('themeJob.noEffectsHint') }}</p>
          <Button variant="outline" @click="fetchJob(true)">{{ t('themeJob.reloadTask') }}</Button>
        </div>
      </template>
    </main>
    <ImagePreviewDialog
      v-model:open="imagePreviewOpen"
      :src="activeResult?.previewUrl"
      :alt="t('themeJob.imageAlt', { n: activeResultIndex + 1 })"
      :title="t('themeJob.imageAltFull', { n: activeResultIndex + 1 })"
      :description="t('themeJob.imageAltTotal', { total: jobData?.results.length ?? 0 })"
    />
  </MainLayout>
</template>
