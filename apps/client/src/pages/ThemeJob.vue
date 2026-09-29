<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Loader2, CheckCircle2, CircleAlert, ImageIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import SelectionShell from '@/features/selection/SelectionShell.vue'
import { getThemeJob, saveThemeSelection, type ThemeJob } from '@/services/api/theme-jobs'

const route = useRoute()
const router = useRouter()
const jobId = route.params.jobId as string

const jobData = ref<ThemeJob | null>(null)
const loading = ref(true)
const error = ref(false)
const polling = ref(false)
const savingSelection = ref(false)

let pollTimer: ReturnType<typeof setTimeout> | null = null
let isPageVisible = true

const handleVisibilityChange = () => {
  isPageVisible = document.visibilityState === 'visible'
  if (isPageVisible && jobData.value && isPending.value && !polling.value) {
    poll()
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  fetchJob(true)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (pollTimer) clearTimeout(pollTimer)
})

async function fetchJob(initial = false) {
  if (initial) loading.value = true
  try {
    const res = await getThemeJob(jobId)
    jobData.value = res
    if (isPending.value) {
      schedulePoll()
    }
  } catch (e) {
    console.error('Failed to load job', e)
    if (initial) error.value = true
  } finally {
    if (initial) loading.value = false
  }
}

async function poll() {
  if (!isPageVisible || !isPending.value) return
  polling.value = true
  try {
    const res = await getThemeJob(jobId)
    jobData.value = res
    if (isPending.value) {
      schedulePoll()
    }
  } catch (e) {
    console.error('Poll failed', e)
    schedulePoll(5000) // retry on error
  } finally {
    polling.value = false
  }
}

function schedulePoll(overrideMs?: number) {
  if (pollTimer) clearTimeout(pollTimer)
  const ms = overrideMs || jobData.value?.pollAfterMs || 2000
  pollTimer = setTimeout(poll, ms)
}

const isPending = computed(() => {
  if (!jobData.value) return false
  return ['pending', 'queued', 'running', 'settling'].includes(jobData.value.status)
})

const isFinished = computed(() => {
  if (!jobData.value) return false
  return ['succeeded', 'partially_succeeded', 'failed'].includes(jobData.value.status)
})

const isFailed = computed(() => jobData.value?.status === 'failed')
const isPartial = computed(() => jobData.value?.status === 'partially_succeeded')

const activeResultIndex = ref(0)
const activeResult = computed(() => {
  if (!jobData.value?.results || jobData.value.results.length === 0) return null
  return jobData.value.results[activeResultIndex.value] || jobData.value.results[0]
})

const selectedResultId = computed(() => jobData.value?.selection.resultId)

async function handleSelectResult(resultId: string) {
  if (!jobData.value || savingSelection.value) return
  savingSelection.value = true
  try {
    const res = await saveThemeSelection(jobId, resultId, jobData.value.selection.revision)
    jobData.value.selection.resultId = res.resultId
    jobData.value.selection.revision = res.revision
  } catch (e: any) {
    console.error('Failed to save selection', e)
    if (e?.response?.status === 409) {
      // Conflict, refetch
      await fetchJob()
    }
  } finally {
    savingSelection.value = false
  }
}

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
    <main class="container mx-auto max-w-4xl px-4 py-8 md:px-6 lg:px-8 space-y-6">
      <div class="flex items-center gap-4">
        <Button variant="ghost" class="-ml-3" @click="router.back()">
          <ArrowLeft class="mr-2 size-4" />返回
        </Button>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold">AI 换主题结果</h1>
          <Badge variant="outline" class="font-mono">{{ jobId }}</Badge>
          <Badge v-if="jobData?.credits.status === 'settled'" variant="secondary" class="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20">积分已结算</Badge>
          <Badge v-else-if="jobData?.credits.status === 'settling'" variant="secondary">结算中</Badge>
          <Badge v-if="isPartial" variant="secondary" class="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20">部分成功</Badge>
        </div>
      </div>

      <div v-if="error" class="rounded-lg border border-destructive/50 bg-destructive/10 p-12 text-center text-destructive">
        <CircleAlert class="size-8 mx-auto mb-4 opacity-50" />
        <h2 class="text-lg font-semibold mb-2">任务加载失败</h2>
        <p class="text-sm">任务不存在或无权访问，请返回重试。</p>
        <Button variant="outline" class="mt-6" @click="router.push('/ai-selection')">返回 AI 智选</Button>
      </div>

      <template v-else-if="jobData">
        <!-- 进度视图 -->
        <Card v-if="isPending" class="border-dashed">
          <CardContent class="p-12 flex flex-col items-center justify-center space-y-6 min-h-[400px]">
            <Loader2 class="size-10 animate-spin text-primary" />
            <div class="text-center space-y-2">
              <h2 class="text-lg font-medium">{{ phaseText }}</h2>
              <p class="text-sm text-muted-foreground">仍在处理中，可安全关闭页面，结果不受影响</p>
            </div>
            <div class="flex gap-4 opacity-50">
              <Skeleton class="w-48 h-32 rounded-lg" />
              <Skeleton class="w-48 h-32 rounded-lg" />
            </div>
          </CardContent>
        </Card>

        <!-- 失败视图 -->
        <Card v-else-if="isFailed" class="border-destructive/30">
          <CardContent class="p-12 flex flex-col items-center justify-center space-y-6">
            <div class="rounded-full bg-destructive/10 p-4">
              <CircleAlert class="size-8 text-destructive" />
            </div>
            <div class="text-center space-y-2">
              <h2 class="text-lg font-semibold">生成失败</h2>
              <p class="text-sm text-muted-foreground">{{ failureReason }}</p>
              <p class="text-sm text-muted-foreground pt-2">预扣除积分已释放</p>
            </div>
            <div class="flex gap-4 pt-4">
              <Button variant="outline" as-child>
                <RouterLink :to="`/schemes/${jobData.schemeCode}`">使用原方案</RouterLink>
              </Button>
              <Button v-if="jobData.failure?.retryable" as-child>
                <RouterLink :to="`/schemes/${jobData.schemeCode}/theme`">重新生成</RouterLink>
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- 成功/部分成功视图 -->
        <div v-else-if="isFinished && jobData.results.length > 0" class="space-y-8">
          <div v-if="isPartial" class="rounded-lg bg-amber-500/10 p-4 text-amber-700 flex items-start gap-3">
            <CircleAlert class="size-5 shrink-0 mt-0.5" />
            <div>
              <h3 class="font-medium">部分结果生成失败</h3>
              <p class="text-sm mt-1">已成功生成 {{ jobData.usableCount }} / {{ jobData.requestedCount }} 张效果图，扣费将按实际成功数量结算。</p>
            </div>
          </div>

          <div class="grid md:grid-cols-2 gap-6">
            <!-- 原图 -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="font-medium flex items-center gap-2"><ImageIcon class="size-4" /> 原版方案</h3>
              </div>
              <div class="aspect-video bg-muted rounded-lg overflow-hidden border relative">
                <img :src="jobData.original.previewUrl" class="w-full h-full object-cover" />
              </div>
            </div>

            <!-- 生成结果 -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="font-medium flex items-center gap-2 text-primary"><CheckCircle2 class="size-4" /> AI 换主题结果</h3>
                <div class="flex gap-1" v-if="jobData.results.length > 1">
                  <button 
                    v-for="(res, i) in jobData.results" :key="res.resultId"
                    class="size-6 rounded-md text-xs font-medium border flex items-center justify-center transition-colors"
                    :class="activeResultIndex === i ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'"
                    @click="activeResultIndex = i"
                  >
                    {{ i + 1 }}
                  </button>
                </div>
              </div>
              
              <div v-if="activeResult" class="aspect-video bg-muted rounded-lg overflow-hidden border relative group">
                <img :src="activeResult.previewUrl" class="w-full h-full object-cover" />
                <div 
                  v-if="selectedResultId === activeResult.resultId"
                  class="absolute top-3 right-3 bg-emerald-500 text-white text-xs font-medium px-2 py-1 rounded shadow-sm flex items-center gap-1"
                >
                  <CheckCircle2 class="size-3" /> 已选为最终效果
                </div>
              </div>

              <div class="flex items-center justify-between pt-2">
                <p class="text-sm text-muted-foreground">
                  <template v-if="jobData.results.length > 1">第 {{ activeResultIndex + 1 }} 张，共 {{ jobData.results.length }} 张</template>
                  <template v-else>生成完毕</template>
                </p>
                <div class="flex gap-3">
                  <Button variant="outline" as-child>
                    <RouterLink :to="`/schemes/${jobData.schemeCode}`">继续使用原方案</RouterLink>
                  </Button>
                  <Button 
                    v-if="activeResult && selectedResultId !== activeResult.resultId"
                    :disabled="savingSelection"
                    @click="handleSelectResult(activeResult.resultId)"
                  >
                    <Loader2 v-if="savingSelection" class="mr-2 size-4 animate-spin" />
                    选为最终效果
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </main>
  </SelectionShell>
</template>
