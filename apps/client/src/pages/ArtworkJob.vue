<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import StatusBadge from '@/components/StatusBadge.vue'
import SelectionShell from '@/features/selection/SelectionShell.vue'
import { useAuthStore } from '@/stores/auth'
import { createArtworkJob, createArtworkJobEventsTicket, directionLabels, downloadArtwork, getArtworkJob, getArtworkJobs, getArtworkOffer, openArtworkJobEvents, type ArtworkContext, type ArtworkJob, type ArtworkOffer, type ArtworkSubmission } from '@/services/api/artwork-jobs'
import { getThemeJob } from '@/services/api/theme-jobs'
import { bindProjectArtworks, getMyProject, type MyProjectDetail } from '@/services/api/projects'
import { useAsyncJob } from '@/composables/useAsyncJob'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const job = ref<ArtworkJob>()
const context = ref<ArtworkContext>()
const reference = ref('')
const offer = ref<ArtworkOffer>()
const project = ref<MyProjectDetail>()
const history = ref<Awaited<ReturnType<typeof getArtworkJobs>>>([])
const pending = ref<ArtworkSubmission>()
const loading = ref(true)
const busy = ref(false)
const downloading = ref('')
const error = ref('')
const bound = ref(false)
let epoch = 0
let destroyed = false
const isRunning = computed(() => !!job.value && ['pending', 'queued', 'running', 'settling'].includes(job.value.status))
const projectId = computed(() => typeof route.query.projectId === 'string' ? route.query.projectId : '')
const ready = computed(() => job.value?.deliveryStatus === 'ready')
const draftKey = computed(() => `booth:artwork-request:${auth.currentUser?.id}:${context.value?.themeJobId}:${context.value?.resultId}:${context.value?.selectionRevision}`)
const canBind = computed(() => ready.value && project.value && !['won', 'lost', 'closed'].includes(project.value.status) && project.value.materialsStatus.artworks !== 'available')
const reasonLabels: Record<string, string> = { ARTWORK_RESOLUTION_TOO_LOW: '输出像素低于高清标准', ARTWORK_FORMAT_INVALID: '输出格式无法验收', ARTWORK_IMAGE_INVALID: '图片无法读取或解码', ARTWORK_SIZE_INVALID: '图片大小不合格', MODEL_UNAVAILABLE: '所选模型已不可用', PROVIDER_OUTCOME_UNKNOWN: '服务商未返回可确认的结果', PROCESSING_FAILED: '处理失败' }

function statusOf(failure: unknown) { return (failure as { response?: { status?: number } }).response?.status }
function login() { void router.push({ path: '/auth/sign-in', query: { redirect: route.fullPath } }) }
function alive(version: number) { return !destroyed && version === epoch }
const asyncJob = useAsyncJob<ArtworkJob>({
  fetch: getArtworkJob,
  createEventsTicket: createArtworkJobEventsTicket,
  openEvents: openArtworkJobEvents,
  isPending: data => ['pending', 'queued', 'running', 'settling'].includes(data.status),
  onData: data => {
    job.value = data
    reference.value = data.referencePreviewUrl ?? ''
    context.value = { schemeCode: data.schemeCode, ...data.themeSelection }
    error.value = ''
  },
  onError: failure => {
    error.value = statusOf(failure) === 404 ? '任务不存在或不属于当前账户。' : '任务状态读取失败，请刷新重试。'
  },
  reconnectDelay: failure => [401, 404].includes(statusOf(failure) ?? 0) ? null : 5000,
})
function fetchJob(initial = false) {
  const id = String(route.params.jobId)
  if (!route.params.jobId) return Promise.resolve(false)
  return asyncJob.start(id, initial)
}
async function load() {
  const version = ++epoch
  asyncJob.stop()
  job.value = undefined; offer.value = undefined; project.value = undefined; context.value = undefined; history.value = []; pending.value = undefined
  loading.value = true; error.value = ''; bound.value = false
  if (!auth.isLoggedIn) { loading.value = false; return }
  try {
    if (route.params.jobId) await fetchJob(true)
    else {
      const themeJobId = String(route.query.themeJobId ?? '')
      const theme = await getThemeJob(themeJobId)
      if (!alive(version)) return
      const selected = theme.results.find(r => r.resultId === theme.selection.resultId)
      if (theme.schemeCode !== route.params.code || !selected) throw new Error('Selected theme unavailable')
      context.value = { schemeCode: theme.schemeCode, themeJobId, resultId: selected.resultId, selectionRevision: theme.selection.revision }
      reference.value = selected.previewUrl
      const saved = sessionStorage.getItem(draftKey.value)
      if (saved) {
        try {
          const submission = JSON.parse(saved) as ArtworkSubmission
          if (submission.resultId === context.value.resultId && submission.selectionRevision === context.value.selectionRevision && submission.themeJobId === context.value.themeJobId && submission.schemeCode === context.value.schemeCode) pending.value = submission
        } catch { sessionStorage.removeItem(draftKey.value) }
      }
      const items = await getArtworkJobs(context.value)
      if (!alive(version)) return
      history.value = items
      if (!pending.value) {
        const currentOffer = await getArtworkOffer(context.value)
        if (!alive(version)) return
        offer.value = currentOffer
      }
    }
    if (!alive(version)) return
    if (projectId.value) {
      const data = await getMyProject(projectId.value)
      if (!alive(version)) return
      const selected = data.selectedThemeSummary
      if (!selected || data.schemeCode !== context.value?.schemeCode || selected.themeJobId !== context.value.themeJobId || selected.resultId !== context.value.resultId || selected.selectionRevision !== context.value.selectionRevision) throw new Error('Project theme mismatch')
      project.value = data
      bound.value = data.artworkJobId === String(route.params.jobId ?? '')
    }
  } catch (failure: unknown) {
    if (alive(version)) error.value = statusOf(failure) === 409 ? '主题选择或模型配置已变化，请返回主题结果确认。' : '无法读取生成上下文，请检查选定主题和登录账户后重试。'
  } finally { if (alive(version)) loading.value = false }
}
async function generate() {
  if (busy.value || !context.value || (!offer.value && !pending.value) || (projectId.value && !project.value)) return
  busy.value = true; error.value = ''
  const version = epoch
  try {
    if (!pending.value) {
      pending.value = { ...context.value, offerId: offer.value!.id, requestKey: crypto.randomUUID() }
      sessionStorage.setItem(draftKey.value, JSON.stringify(pending.value))
    }
    const receipt = await createArtworkJob(pending.value)
    if (!alive(version)) return
    sessionStorage.removeItem(draftKey.value); pending.value = undefined
    await router.push({ path: `/artwork-jobs/${receipt.jobId}`, query: projectId.value ? { projectId: projectId.value } : {} })
  } catch (failure: unknown) {
    if (!alive(version)) return
    const status = statusOf(failure)
    if (status && status < 500 && ![408, 429].includes(status)) {
      sessionStorage.removeItem(draftKey.value); pending.value = undefined; offer.value = undefined
      error.value = status === 402 ? '可用积分不足，请充值后重新读取费用。' : status === 401 ? '登录已失效，请重新登录。' : '主题选择或费用已变化，请刷新并重新确认。'
    } else error.value = '暂未确认提交结果。本次提交已保留，请重试确认，避免重复预占积分。'
  } finally { busy.value = false }
}
async function bind() {
  if (!project.value || !job.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    await bindProjectArtworks(project.value.projectId, { artworkJobId: job.value.jobId, expectedRevision: project.value.revision, requestKey: crypto.randomUUID() })
    project.value = await getMyProject(project.value.projectId); bound.value = true
  } catch { error.value = '交付未确认。请刷新项目，检查版本、处理状态与固定主题后重试。' }
  finally { busy.value = false }
}
async function download(assetId?: string, direction?: string) {
  if (!job.value || downloading.value) return
  downloading.value = assetId ?? 'archive'; error.value = ''
  try {
    const blob = await downloadArtwork(job.value.jobId, assetId)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url
    anchor.download = assetId ? `${direction}.png` : `${job.value.schemeCode}-四面素材.zip`
    document.body.appendChild(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { error.value = '文件读取或完整性校验失败，请稍后重试。' }
  finally { downloading.value = '' }
}
onMounted(() => void load())
watch(() => route.fullPath, () => void load())
watch(() => auth.currentUser?.id, () => void load())
onUnmounted(() => { destroyed = true; epoch++; asyncJob.stop() })
</script>

<template>
  <SelectionShell><main id="main-content" class="studio-page">
    <header class="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
      <div><p class="studio-eyebrow mb-3">主题 / 四面素材 / 交付</p><h1 class="studio-title">让主题，延伸到每一面</h1><p class="mt-3 text-sm text-muted-foreground">固定主题 · 四方向高清底图 · 项目资料交付</p></div>
      <Button v-if="context" variant="outline" as-child><RouterLink :to="`/theme-jobs/${context.themeJobId}`"><ArrowLeft class="mr-2 size-4" />返回主题效果</RouterLink></Button>
    </header>
    <Card v-if="!auth.isLoggedIn"><CardContent class="space-y-4 p-8"><p>登录后读取您选定的主题并生成配套素材。</p><Button @click="login">登录并返回</Button></CardContent></Card>
    <div v-else-if="loading" role="status" class="flex items-center gap-3 py-16"><Loader2 class="size-6 animate-spin text-primary" />正在读取素材工作台…</div>
    <template v-else>
      <div v-if="error" role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{{ error }}</p><Button variant="outline" :disabled="busy" @click="load"><RefreshCw class="mr-2 size-4" />刷新状态</Button></div>
      <div v-if="context" class="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside class="space-y-6 lg:sticky lg:top-24">
          <section class="space-y-4"><div class="flex items-center justify-between"><h2 class="text-lg font-medium">01 / 主题参考</h2><span class="text-xs text-muted-foreground">已固定</span></div><img v-if="reference" :src="reference" alt="四面素材对应的选定主题效果" class="aspect-video w-full rounded-md bg-image-surface object-contain" /><dl class="space-y-2 text-sm"><div class="flex justify-between gap-3"><dt class="shrink-0 text-muted-foreground">方案</dt><dd class="break-all font-mono">{{ context.schemeCode }}</dd></div><div class="flex justify-between"><dt class="text-muted-foreground">主题选择修订</dt><dd>{{ context.selectionRevision }}</dd></div></dl><p class="break-all font-mono text-xs text-muted-foreground">{{ context.resultId }}</p></section>
          <section class="space-y-3 border-t pt-5"><h2 class="text-lg font-medium">交付标准</h2><p class="text-sm leading-6 text-muted-foreground">实际解码并统一转为 PNG。长边 ≥ 1536 px，短边 ≥ 1024 px；不以插值放大代替高清验收。</p><p class="text-sm leading-6 text-muted-foreground">素材为四面方向底图。画面清单映射、物理尺寸与印刷适配尚需确认。</p></section>
          <RouterLink v-if="project" :to="`/my-projects/${project.projectId}`" class="flex items-center justify-between rounded-lg border p-4 text-sm"><span>项目 {{ project.projectNo }}</span><ArrowRight class="size-4" /></RouterLink>
        </aside>
        <section class="space-y-6">
          <Card v-if="!job" class="border-0"><CardContent class="space-y-6 p-6 md:p-8">
            <div><p class="studio-eyebrow">02 / 成套生成</p><h2 class="mt-2 text-xl font-medium">正、背、左、右，共用一个主题</h2><p class="mt-3 text-sm leading-7 text-muted-foreground">每个方向沿用同一参考效果、品牌参数、模型和提示词快照。只有四方向均通过验收，才可完整打包和绑定项目。</p></div>
            <dl v-if="offer" class="grid gap-5 border-y py-5 text-sm sm:grid-cols-3">
              <div><dt class="text-muted-foreground">每方向</dt><dd class="mt-2 font-mono text-lg">{{ offer.unitCredits }} <span class="font-sans text-sm">积分</span></dd></div>
              <div><dt class="text-muted-foreground">本次预占</dt><dd class="mt-2 font-mono text-lg">{{ offer.maxCredits }} <span class="font-sans text-sm">积分</span></dd></div>
              <div><dt class="text-muted-foreground">结算方式</dt><dd class="mt-2">按合格方向</dd></div>
            </dl>
            <p class="text-sm leading-7 text-muted-foreground">失败方向释放预占；部分成功可下载合格单张，但不能作为完整套装交付。重新生成会创建新的四面任务并重新计费。</p>
            <Button class="h-auto min-h-11 whitespace-normal" :disabled="busy || (!offer && !pending) || (!!projectId && !project)" @click="generate"><Loader2 v-if="busy" class="mr-2 size-4 animate-spin" />{{ pending ? '确认上次提交结果' : '确认费用，生成四面素材' }}</Button>
          </CardContent></Card>
          <div v-if="!job && history.length" class="space-y-3"><h2 class="text-sm font-medium">这个主题的生成记录</h2><RouterLink v-for="item in history" :key="item.jobId" :to="{ path: `/artwork-jobs/${item.jobId}`, query: projectId ? { projectId } : {} }" class="flex items-center justify-between rounded-lg border px-4 py-3 text-sm"><span class="font-mono">{{ item.jobId.slice(0, 8) }}</span><span>{{ item.deliveryStatus === 'ready' ? '四面齐全' : ['pending', 'queued', 'running', 'settling'].includes(item.status) ? '处理中' : '未成套' }}</span><ArrowRight class="size-4" /></RouterLink></div>
          <template v-if="job">
            <div class="flex flex-wrap items-center justify-between gap-4"><div><p class="text-xs text-muted-foreground">02 / 四面成果</p><h2 class="mt-2 flex items-center gap-2 text-xl font-medium"><Loader2 v-if="isRunning" class="size-5 animate-spin text-primary" /><CheckCircle2 v-else-if="ready" class="size-5 text-primary" />{{ isRunning ? '四方向正在生成与验收' : ready ? '四面齐全，已通过像素与格式验收' : '本次成果尚未成套' }}</h2><p class="mt-2 text-xs text-muted-foreground">可关闭页面，任务将继续处理 · {{ job.jobId.slice(0, 8) }}</p></div><Button variant="outline" @click="fetchJob()"><RefreshCw class="mr-2 size-4" />刷新</Button></div>
           <div class="grid gap-4 sm:grid-cols-2"><Card v-for="(item, index) in job.directions" :key="item.direction"><CardContent class="space-y-3 p-4"><div class="flex items-center justify-between"><h3 class="text-sm font-medium"><span class="mr-2 font-mono text-xs text-muted-foreground">0{{ index + 1 }}</span>{{ directionLabels[item.direction] }}</h3><StatusBadge domain="artwork" :status="item.status" /></div><div class="flex aspect-video items-center justify-center rounded-md bg-muted/40"><img v-if="item.previewUrl" :src="item.previewUrl" :alt="`${directionLabels[item.direction]}方向底图`" class="h-full w-full object-contain" /><Loader2 v-else-if="item.status !== 'failed'" class="size-7 animate-spin text-muted-foreground" /><p v-else class="px-5 text-center text-xs leading-6 text-muted-foreground">{{ reasonLabels[item.reason ?? ''] ?? '该方向未通过验收' }}</p></div><div class="flex items-center justify-between"><p class="text-xs text-muted-foreground">{{ item.width ? `${item.width} × ${item.height} px · PNG` : '等待合格文件' }}</p><Button v-if="item.assetId" variant="ghost" size="sm" :disabled="!!downloading" @click="download(item.assetId, item.direction)"><Download class="mr-1 size-3" />单张</Button></div></CardContent></Card></div>
            <Card><CardContent class="space-y-4 p-6"><div class="flex flex-wrap gap-x-6 gap-y-2 text-sm"><p>预占 {{ job.credits.reservedCredits }} 积分</p><p>当前冻结 {{ job.credits.heldCredits }} 积分</p><p>已扣 {{ job.credits.chargedCredits }} 积分</p><p>已释放 {{ job.credits.releasedCredits }} 积分</p></div><p v-if="!isRunning && !ready" class="text-sm text-muted-foreground">缺少：{{ job.missingDirections.map(d => directionLabels[d]).join('、') }}。当前不可完整打包或交付项目。</p><div class="flex flex-wrap gap-3"><Button v-if="ready" :disabled="!!downloading" @click="download()"><Download class="mr-2 size-4" />{{ downloading === 'archive' ? '正在打包…' : '下载完整四面 ZIP' }}</Button><Button v-if="canBind" variant="outline" :disabled="busy" @click="bind"><Loader2 v-if="busy" class="mr-2 size-4 animate-spin" />绑定到当前项目</Button><span v-if="bound" class="flex items-center gap-2 text-sm text-primary"><CheckCircle2 class="size-4" />已固定为项目资料</span><Button v-if="ready && !projectId" variant="outline" as-child><RouterLink :to="{ path: `/schemes/${encodeURIComponent(job.schemeCode)}/quote`, query: { themeJobId: context.themeJobId, artworkJobId: job.jobId } }">携带素材申请报价<ArrowRight class="ml-2 size-4" /></RouterLink></Button><Button v-if="!isRunning" variant="ghost" as-child><RouterLink :to="{ path: `/schemes/${encodeURIComponent(job.schemeCode)}/artwork`, query: { themeJobId: context.themeJobId, ...(projectId ? { projectId } : {}) } }">重新确认并生成</RouterLink></Button></div></CardContent></Card>
          </template>
        </section>
      </div>
    </template>
  </main></SelectionShell>
</template>
