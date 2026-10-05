<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Loader2, CheckCircle2, CircleAlert, ImageIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import StatusBadge from '@/components/StatusBadge.vue'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import ImagePreviewDialog from '@/components/ImagePreviewDialog.vue'
import SelectionShell from '@/features/selection/SelectionShell.vue'
import { cn } from '@/lib/utils'
import { useAsyncJob } from '@/composables/useAsyncJob'
import { createThemeJobEventsTicket, getThemeJob, openThemeJobEvents, saveThemeSelection, type ThemeJob } from '@/services/api/theme-jobs'

const route = useRoute()
const router = useRouter()
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
  if (!canSelect.value) return '任务当前不可选用效果，请查看任务状态。'
  if (selectedResult.value) return `当前已选定第 ${selectedResultIndex.value + 1} 张，报价和四面素材将使用此效果。`
  if (selectedResultId.value) return '当前选定效果不可用，请重新选用一张效果图。'
  return '当前尚未选定效果，请预览后点击“选用此效果”。'
}

async function refreshSelection(conflict = false) {
  if (refreshingSelection.value) return
  refreshingSelection.value = true
  const refreshed = await fetchJob()
  if (!disposed) {
    selectionUncertain.value = !refreshed
    selectionNotice.value = refreshed
      ? { tone: conflict ? 'warning' : 'success', message: `${conflict ? '选定状态已发生变化，本次选择未覆盖最新状态。已刷新：' : '已刷新选定状态：'}${selectionSummary()}` }
      : { tone: 'error', message: `${conflict ? '选定状态已发生变化，' : ''}刷新失败，暂时无法确认当前选定效果。请重试刷新后再选用、申请报价或生成素材。` }
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
    selectionNotice.value = { tone: 'success', message: `选择已保存。${selectionSummary()}` }
  } catch (e: unknown) {
    if (disposed) return
    selectionUncertain.value = true
    const status = (e as { response?: { status?: number }; statusCode?: number } | null)?.response?.status
      ?? (e as { statusCode?: number } | null)?.statusCode
    if (status === 409) await refreshSelection(true)
    else selectionNotice.value = { tone: 'error', message: '保存选定效果失败，暂时无法确认是否保存成功。当前预览已保留，请先刷新选定状态，再决定是否重新选用。' }
  } finally {
    savingSelection.value = false
  }
}

function continueWithSelection(destination: 'quote' | 'artwork') {
  if (!canContinue.value || !jobData.value) return
  void router.push({ path: `/schemes/${encodeURIComponent(jobData.value.schemeCode)}/${destination}`, query: { themeJobId: jobId } })
}

const statusText = computed(() => {
  if (!jobData.value) return '加载中'
  const labels: Record<ThemeJob['status'], string> = {
    pending: '等待处理', queued: '排队中', running: '生成中', settling: '结算中',
    succeeded: '生成完成', partially_succeeded: '部分完成', failed: '生成失败',
  }
  return labels[jobData.value.status]
})

const phaseText = computed(() => {
  if (!jobData.value) return '加载中...'
  if (jobData.value.status === 'queued') return '排队中'
  if (jobData.value.status === 'running') return 'AI 正在生成'
  if (jobData.value.status === 'settling') return '正在结算'
  return jobData.value.phase || '请稍候'
})

const failureReason = computed(() => {
  const reason = jobData.value?.failure?.reason
  if (!reason) return '未知错误'
  const map: Record<string, string> = {
    'INSUFFICIENT_CREDITS': '积分不足',
    'PROVIDER_ERROR': 'AI 服务商暂不可用',
    'INTERNAL_ERROR': '系统内部错误'
  }
  return map[reason] || reason
})

</script>

<template>
  <SelectionShell>
    <main id="main-content" class="studio-page">
      <header class="studio-header">
        <Button variant="ghost" class="-ml-3" @click="router.back()">
          <ArrowLeft class="mr-2 size-4" />返回
        </Button>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 space-y-2">
            <p v-if="jobData" class="break-all text-sm text-muted-foreground">方案 {{ jobData.schemeCode }}</p>
            <h1 class="studio-title">AI 换主题结果</h1>
            <p class="text-sm text-muted-foreground">先预览对比，再选定用于报价与四面素材的效果。</p>
          </div>
          <div v-if="jobData" class="flex flex-wrap gap-2">
            <StatusBadge domain="job" :status="jobData.status" :label="statusText" class="gap-1.5 py-1">
              <Loader2 v-if="isPending" class="size-3.5 animate-spin" />
              <CircleAlert v-else-if="isFailed || isPartial" class="size-3.5" />
              <CheckCircle2 v-else class="size-3.5" />
            </StatusBadge>
            <Badge v-if="jobData.credits.status === 'settled'" variant="secondary">积分已结算</Badge>
          </div>
        </div>
        <details class="text-xs text-muted-foreground">
          <summary class="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">任务信息</summary>
          <p class="mt-2 break-all font-mono">任务编号：{{ jobId }}</p>
        </details>
      </header>

      <div v-if="loading" class="space-y-4" role="status">
        <p class="text-sm text-muted-foreground">正在加载任务…</p>
        <Skeleton class="aspect-video w-full rounded-xl" />
      </div>

      <div v-else-if="error" role="alert" class="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-destructive sm:p-12">
        <CircleAlert class="size-8 mx-auto mb-4 opacity-50" />
        <h2 class="text-lg font-semibold mb-2">任务加载失败</h2>
        <p class="text-sm">暂时无法获取任务，请重试。若仍无法加载，请确认任务是否存在及当前账户是否有权访问。</p>
        <div class="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="outline" @click="fetchJob(true)">重新加载任务</Button>
          <Button variant="ghost" @click="router.push('/ai-selection')">返回 AI 智选</Button>
        </div>
      </div>

      <template v-else-if="jobData">
        <div v-if="selectionNotice" :role="selectionNotice.tone === 'error' ? 'alert' : 'status'" :class="cn('space-y-3 rounded-lg border p-4 text-sm', selectionNotice.tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : selectionNotice.tone === 'warning' ? 'border-warning/30 bg-warning/5 text-warning' : 'border-success/30 bg-success/5 text-success')">
          <p>{{ selectionNotice.message }}</p>
          <Button v-if="selectionUncertain" variant="outline" :disabled="selectionBusy" @click="refreshSelection()">
            <Loader2 v-if="refreshingSelection" class="mr-2 size-4 animate-spin" />
            {{ refreshingSelection ? '正在刷新…' : '刷新选定状态' }}
          </Button>
        </div>
        <!-- 进度视图 -->
        <Card v-if="isPending" class="border-dashed">
          <CardContent class="flex min-h-[360px] flex-col items-center justify-center space-y-6 p-6 sm:p-12" role="status">
            <Loader2 class="size-10 animate-spin text-primary" />
            <div class="text-center space-y-2">
              <h2 class="text-lg font-medium">{{ phaseText }}</h2>
              <p class="text-sm text-muted-foreground">仍在处理中，可安全关闭页面，结果不受影响</p>
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
              <h2 class="text-lg font-semibold">生成失败</h2>
              <p class="text-sm text-muted-foreground">{{ failureReason }}</p>
              <p v-if="jobData.credits.status === 'released'" class="pt-2 text-sm text-muted-foreground">预扣除积分已释放</p>
            </div>
            <div class="flex flex-wrap justify-center gap-4 pt-4">
              <Button variant="outline" as-child>
                <RouterLink :to="{ path: `/schemes/${encodeURIComponent(jobData.schemeCode)}`, query: jobData.searchId ? { searchId: jobData.searchId } : {} }">使用原方案</RouterLink>
              </Button>
              <Button v-if="jobData.failure?.retryable" as-child>
                <RouterLink :to="{ path: `/schemes/${encodeURIComponent(jobData.schemeCode)}/theme`, query: jobData.searchId ? { searchId: jobData.searchId } : {} }">重新生成</RouterLink>
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- 成功/部分成功视图 -->
        <div v-else-if="isFinished && jobData.results.length > 0" class="space-y-8">
          <div v-if="isPartial" class="flex items-start gap-3 rounded-lg bg-warning/10 p-4 text-warning">
            <CircleAlert class="size-5 shrink-0 mt-0.5" />
            <div>
              <h3 class="font-medium">部分结果生成失败</h3>
              <p class="text-sm mt-1">已成功生成 {{ jobData.usableCount }} / {{ jobData.requestedCount }} 张效果图，扣费将按实际成功数量结算。</p>
            </div>
          </div>

          <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section class="min-w-0 space-y-4" aria-labelledby="preview-heading">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 id="preview-heading" class="text-lg font-semibold" aria-live="polite">正在预览第 {{ activeResultIndex + 1 }} 张 <span class="text-sm font-normal text-muted-foreground">/ 共 {{ jobData.results.length }} 张</span></h2>
                <Badge v-if="activeResult?.resultId === selectedResultId && !selectionUncertain" variant="outline" class="gap-1 border-success/30 text-success"><CheckCircle2 class="size-3.5" />已选定效果</Badge>
                <Badge v-else variant="secondary">仅预览</Badge>
              </div>
              <button v-if="activeResult" type="button" class="aspect-video w-full overflow-hidden rounded-md bg-image-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" :aria-label="`放大第 ${activeResultIndex + 1} 张主题效果`" @click="imagePreviewOpen = true">
                <img :src="activeResult.previewUrl" :alt="`正在预览的第 ${activeResultIndex + 1} 张主题效果`" class="h-full w-full object-contain" />
              </button>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="切换效果预览">
                <button
                  v-for="(result, index) in jobData.results" :key="result.resultId"
                  type="button"
                  :aria-label="`预览第 ${index + 1} 张${result.resultId === selectedResultId && !selectionUncertain ? '，已选定效果' : ''}`"
                  :aria-pressed="activeResultIndex === index"
                  :class="cn('min-w-0 overflow-hidden rounded-lg border bg-background text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background', activeResultIndex === index ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50')"
                  @click="previewResultId = result.resultId"
                >
                  <img :src="result.previewUrl" alt="" class="aspect-video w-full bg-muted/40 object-contain" />
                  <span class="flex flex-wrap items-center justify-between gap-1 p-2 text-xs">
                    <span>第 {{ index + 1 }} 张</span>
                    <span v-if="result.resultId === selectedResultId && !selectionUncertain" class="flex items-center gap-1 text-success"><CheckCircle2 class="size-3" />已选定</span>
                    <span v-else-if="activeResultIndex === index" class="text-primary">预览中</span>
                  </span>
                </button>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p class="text-sm text-muted-foreground">切换预览不会改变已选定效果。</p>
                <Button
                  v-if="activeResult && (selectedResultId !== activeResult.resultId || selectionUncertain || savingSelection)"
                  :variant="selectedResult ? 'outline' : 'default'"
                  :disabled="selectionBusy || selectionUncertain"
                  class="h-auto min-h-10 whitespace-normal"
                  @click="handleSelectResult(activeResult.resultId)"
                >
                  <Loader2 v-if="selectionBusy" class="mr-2 size-4 shrink-0 animate-spin" />
                  {{ savingSelection ? `正在保存第 ${savingResultNumber} 张…` : '选用此效果' }}
                </Button>
                <p v-else class="flex items-center gap-1.5 text-sm text-success"><CheckCircle2 class="size-4" />此效果已选定</p>
              </div>
              <details class="border-t py-5">
                <summary class="flex cursor-pointer items-center gap-2 rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ImageIcon class="size-4" />查看原版方案对比</summary>
                <img :src="jobData.original.previewUrl" alt="原版方案效果图" class="mt-4 aspect-video w-full rounded-lg bg-muted/40 object-contain" />
              </details>
            </section>

            <aside class="studio-panel min-w-0 space-y-5 p-6 lg:sticky lg:top-24" aria-labelledby="selected-heading" :aria-busy="selectionBusy">
              <div class="space-y-2">
                <h2 id="selected-heading" class="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 class="size-5 text-primary" />已选定效果</h2>
                <p class="text-sm text-muted-foreground">报价与四面素材均使用这里的效果。</p>
              </div>
              <div v-if="selectionUncertain" class="space-y-2 rounded-lg bg-warning/10 p-4 text-sm text-warning">
                <p class="font-medium">选定状态待确认</p>
                <p>请先刷新选定状态，确认实际保存的效果。</p>
              </div>
              <div v-else-if="selectedResult" class="space-y-3">
                <img :src="selectedResult.previewUrl" :alt="`已选定的第 ${selectedResultIndex + 1} 张主题效果`" class="aspect-video w-full rounded-lg border bg-muted/40 object-contain" />
                <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span class="flex items-center gap-1.5 font-medium text-success"><CheckCircle2 class="size-4" />已选定第 {{ selectedResultIndex + 1 }} 张</span>
                  <Button v-if="activeResult?.resultId !== selectedResultId" variant="ghost" size="sm" @click="previewResultId = selectedResultId ?? null">预览已选定效果</Button>
                </div>
                <p v-if="activeResult?.resultId !== selectedResultId" class="text-sm text-muted-foreground">您正在预览第 {{ activeResultIndex + 1 }} 张，后续仍使用已选定的第 {{ selectedResultIndex + 1 }} 张。</p>
              </div>
              <div v-else class="space-y-2 rounded-lg border border-dashed p-5 text-sm">
                <p class="font-medium">{{ selectedResultId ? '已选定效果不可用' : '尚未选定效果' }}</p>
                <p class="text-muted-foreground">找到满意的一张后，点击“选用此效果”，再继续申请报价或生成素材。</p>
              </div>
              <div class="space-y-3 border-t pt-5">
                <Button class="h-auto min-h-11 w-full whitespace-normal" :disabled="!canContinue" @click="continueWithSelection('quote')">使用已选定效果申请报价<ArrowRight class="ml-2 size-4 shrink-0" /></Button>
                <Button variant="outline" class="h-auto min-h-11 w-full whitespace-normal" :disabled="!canContinue" @click="continueWithSelection('artwork')">使用已选定效果生成四面素材</Button>
                <p class="text-xs leading-relaxed text-muted-foreground">四面素材为可选步骤，可直接使用已选定效果申请报价。</p>
              </div>
              <Button variant="ghost" class="h-auto min-h-10 w-full whitespace-normal" as-child>
                <RouterLink :to="{ path: `/schemes/${encodeURIComponent(jobData.schemeCode)}`, query: jobData.searchId ? { searchId: jobData.searchId } : {} }">继续使用原方案</RouterLink>
              </Button>
            </aside>
          </div>
        </div>
        <div v-else-if="isFinished" class="space-y-3 rounded-lg border p-6" role="status">
          <h2 class="font-semibold">暂无可预览的效果图</h2>
          <p class="text-sm text-muted-foreground">请重新加载任务，或返回方案重新生成。</p>
          <Button variant="outline" @click="fetchJob(true)">重新加载任务</Button>
        </div>
      </template>
    </main>
    <ImagePreviewDialog
      v-model:open="imagePreviewOpen"
      :src="activeResult?.previewUrl"
      :alt="`正在预览的第 ${activeResultIndex + 1} 张主题效果`"
      :title="`第 ${activeResultIndex + 1} 张主题效果`"
      :description="`共 ${jobData?.results.length ?? 0} 张生成效果。`"
    />
  </SelectionShell>
</template>
