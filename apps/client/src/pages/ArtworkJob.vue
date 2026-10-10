<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ArrowRight, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import StatusBadge from '@/components/StatusBadge.vue'
import MainLayout from '@/layouts/MainLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { createArtworkJob, createArtworkJobEventsTicket, downloadArtwork, getArtworkJob, getArtworkJobs, getArtworkOffer, openArtworkJobEvents, type ArtworkContext, type ArtworkJob, type ArtworkOffer, type ArtworkSubmission } from '@/services/api/artwork-jobs'
import { getDirectionLabels, getReasonLabels } from '@/features/artwork-jobs/labels'
import { getThemeJob } from '@/services/api/theme-jobs'
import { bindProjectArtworks, getMyProject, type MyProjectDetail } from '@/services/api/projects'
import { useAsyncJob } from '@/composables/useAsyncJob'
import { useSignedUrlRenewal } from '@/composables/useSignedUrlRenewal'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const directionLabels = computed(() => getDirectionLabels(t))
const reasonLabels = computed(() => getReasonLabels(t))
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
function statusOf(failure: unknown) { return (failure as { response?: { status?: number } }).response?.status }
function reasonOf(failure: unknown) { return (failure as { data?: { error?: { reason?: string } } }).data?.error?.reason }
// 提交草稿存储异常（被禁用、配额已满）不影响提交与跳转：同一页面内重试仍复用内存中的请求键，只是刷新后无法恢复
function readDraft(key: string) { try { return sessionStorage.getItem(key) } catch { return null } }
function writeDraft(key: string, value: ArtworkSubmission) { try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { return } }
function removeDraft(key: string) { try { sessionStorage.removeItem(key) } catch { return } }
// 报价有效期 5 分钟；剩余不足此值时提交前先换新报价，避免提交时才被服务端以过期拒绝
const offerRenewMarginMs = 10_000
// 方向图与参考图为预签名链接（最短 5 分钟）：停留过久后图片加载失败或页面重新可见时换新链接
const imageLinks = useSignedUrlRenewal(renewImages, 300_000)
async function renewImages() {
  if (route.params.jobId) { await fetchJob(); return }
  const current = context.value
  if (!current) return
  const version = epoch
  const theme = await getThemeJob(current.themeJobId)
  if (!alive(version)) return
  const selected = theme.results.find(r => r.resultId === current.resultId)
  if (selected) { reference.value = selected.previewUrl; imageLinks.markFresh() }
}
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
    imageLinks.markFresh()
    error.value = ''
  },
  onError: failure => {
    error.value = statusOf(failure) === 404 ? t('artworkJob.errorNotExist') : t('artworkJob.errorReadFailed')
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
      imageLinks.markFresh()
      const saved = readDraft(draftKey.value)
      if (saved) {
        try {
          const submission = JSON.parse(saved) as ArtworkSubmission
          if (submission.resultId === context.value.resultId && submission.selectionRevision === context.value.selectionRevision && submission.themeJobId === context.value.themeJobId && submission.schemeCode === context.value.schemeCode) pending.value = submission
        } catch { removeDraft(draftKey.value) }
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
    if (alive(version)) error.value = statusOf(failure) === 409 ? t('artworkJob.errorContextChanged') : t('artworkJob.errorNoContext')
  } finally { if (alive(version)) loading.value = false }
}
async function generate() {
  if (busy.value || !context.value || (!offer.value && !pending.value) || (projectId.value && !project.value)) return
  busy.value = true; error.value = ''
  const version = epoch
  const key = draftKey.value
  try {
    if (!pending.value) {
      if (Date.parse(offer.value!.expiresAt) - Date.now() < offerRenewMarginMs && !await renewOffer(version, true)) return
      pending.value = { ...context.value, offerId: offer.value!.id, requestKey: crypto.randomUUID() }
      writeDraft(key, pending.value)
    }
    const receipt = await createArtworkJob(pending.value)
    if (!alive(version)) return
    removeDraft(key); pending.value = undefined
    await router.push({ path: `/artwork-jobs/${receipt.jobId}`, query: projectId.value ? { projectId: projectId.value } : {} })
  } catch (failure: unknown) {
    if (!alive(version)) return
    const status = statusOf(failure)
    if (status && status < 500 && ![408, 429].includes(status)) {
      // 服务端已明确拒绝，未创建任务：丢弃原请求键，按原因给出恢复路径
      const reason = reasonOf(failure)
      removeDraft(key); pending.value = undefined
      if (reason === 'OFFER_EXPIRED') { await renewOffer(version, false); return }
      offer.value = undefined
      error.value = status === 402 ? t('artworkJob.errorInsufficientCredits') : status === 401 ? t('artworkJob.errorAuthExpired')
        : reason === 'MODEL_UNAVAILABLE' ? t('artworkJob.errorServiceUnavailable') : t('artworkJob.errorThemeChanged')
    } else error.value = t('artworkJob.errorSubmitPending')
  } finally { busy.value = false }
}
/**
 * 换新报价。beforeSubmit 为 true 时费用未变化返回 true 继续提交；费用变化则展示新费用、提示再次确认并返回 false。
 * 提交被以过期拒绝后调用时只展示新报价，由用户再次确认。
 */
async function renewOffer(version: number, beforeSubmit: boolean) {
  const previous = offer.value
  try {
    const fresh = await getArtworkOffer(context.value!)
    if (!alive(version)) return false
    offer.value = fresh
    const changed = !previous || fresh.unitCredits !== previous.unitCredits || fresh.maxCredits !== previous.maxCredits
    if (beforeSubmit && !changed) return true
    error.value = changed ? t('artworkJob.offerChanged') : t('artworkJob.offerRenewed')
  } catch (failure: unknown) {
    if (alive(version)) error.value = statusOf(failure) === 409 ? t('artworkJob.errorThemeChanged') : t('artworkJob.errorOfferFailed')
  }
  return false
}
async function bind() {
  if (!project.value || !job.value || busy.value) return
  busy.value = true; error.value = ''
  try {
    await bindProjectArtworks(project.value.projectId, { artworkJobId: job.value.jobId, expectedRevision: project.value.revision, requestKey: crypto.randomUUID() })
    project.value = await getMyProject(project.value.projectId); bound.value = true
  } catch { error.value = t('artworkJob.errorDeliveryPending') }
  finally { busy.value = false }
}
async function download(assetId?: string, direction?: string) {
  if (!job.value || downloading.value) return
  downloading.value = assetId ?? 'archive'; error.value = ''
  try {
    const blob = await downloadArtwork(job.value.jobId, assetId)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url
    anchor.download = assetId ? `${direction}.png` : `${job.value.schemeCode}-${t('controls.downloadArtworkZip')}.zip`
    document.body.appendChild(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { error.value = t('artworkJob.errorFileFailed') }
  finally { downloading.value = '' }
}
onMounted(() => void load())
watch(() => route.fullPath, () => void load())
watch(() => auth.currentUser?.id, () => void load())
onUnmounted(() => { destroyed = true; epoch++; asyncJob.stop() })
</script>

<template>
  <MainLayout><main id="main-content" class="studio-page">
    <header class="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
      <div><p class="studio-eyebrow mb-3">{{ t('artworkJob.pageTitle') }}</p><h1 class="studio-title">{{ t('artworkJob.pageHeading') }}</h1><p class="mt-3 text-sm text-muted-foreground">{{ t('artworkJob.pageDesc') }}</p></div>
      <Button v-if="context" variant="outline" as-child><RouterLink :to="`/theme-jobs/${context.themeJobId}`"><ArrowLeft class="mr-2 size-4" />{{ t('artworkJob.backToTheme') }}</RouterLink></Button>
    </header>
    <Card v-if="!auth.isLoggedIn"><CardContent class="space-y-4 p-8"><p>{{ t('artworkJob.loginPrompt') }}</p><Button @click="login">{{ t('artworkJob.loginAndReturn') }}</Button></CardContent></Card>
    <div v-else-if="loading" role="status" class="flex items-center gap-3 py-16"><Loader2 class="size-6 animate-spin text-primary" />{{ t('artworkJob.workspaceLoading') }}</div>
    <template v-else>
      <div v-if="error" role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{{ error }}</p><Button variant="outline" :disabled="busy" @click="load"><RefreshCw class="mr-2 size-4" />{{ t('artworkJob.refreshStatus') }}</Button></div>
      <div v-if="context" class="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside class="space-y-6 lg:sticky lg:top-24">
          <section class="space-y-4"><div class="flex items-center justify-between"><h2 class="text-lg font-medium">{{ t('artworkJob.themeRefTitle') }}</h2><span class="text-xs text-muted-foreground">{{ t('artworkJob.themeFixed') }}</span></div><img v-if="reference" :src="reference" :alt="t('artworkJob.themeRefDesc')" class="aspect-video w-full rounded-md bg-image-surface object-contain" @error="imageLinks.onImageError" /><dl class="space-y-2 text-sm"><div class="flex justify-between gap-3"><dt class="shrink-0 text-muted-foreground">{{ t('artworkJob.schemeLabel') }}</dt><dd class="break-all font-mono">{{ context.schemeCode }}</dd></div><div class="flex justify-between"><dt class="text-muted-foreground">{{ t('artworkJob.themeRevision') }}</dt><dd>{{ context.selectionRevision }}</dd></div></dl><p class="break-all font-mono text-xs text-muted-foreground">{{ context.resultId }}</p></section>
          <section class="space-y-3 border-t pt-5"><h2 class="text-lg font-medium">{{ t('artworkJob.deliveryStandard') }}</h2><p class="text-sm leading-6 text-muted-foreground">{{ t('artworkJob.deliveryDesc') }}</p><p class="text-sm leading-6 text-muted-foreground">{{ t('artworkJob.deliveryNote') }}</p></section>
          <RouterLink v-if="project" :to="`/my-projects/${project.projectId}`" class="flex items-center justify-between rounded-lg border p-4 text-sm"><span>{{ t('artworkJob.projectLabel') }} {{ project.projectNo }}</span><ArrowRight class="size-4" /></RouterLink>
        </aside>
        <section class="space-y-6">
          <Card v-if="!job" class="border-0"><CardContent class="space-y-6 p-6 md:p-8">
            <div><p class="studio-eyebrow">{{ t('artworkJob.generateTitle') }}</p><h2 class="mt-2 text-xl font-medium">{{ t('artworkJob.generateDesc') }}</h2><p class="mt-3 text-sm leading-7 text-muted-foreground">{{ t('artworkJob.generateNote') }}</p></div>
            <dl v-if="offer" class="grid gap-5 border-y py-5 text-sm sm:grid-cols-3">
              <div><dt class="text-muted-foreground">{{ t('artworkJob.costPerDir') }}</dt><dd class="mt-2 font-mono text-lg">{{ offer.unitCredits }} <span class="font-sans text-sm">{{ t('artworkJob.costCredits') }}</span></dd></div>
              <div><dt class="text-muted-foreground">{{ t('artworkJob.costPreoccupy') }}</dt><dd class="mt-2 font-mono text-lg">{{ offer.maxCredits }} <span class="font-sans text-sm">{{ t('artworkJob.costCredits') }}</span></dd></div>
              <div><dt class="text-muted-foreground">{{ t('artworkJob.costSettlement') }}</dt><dd class="mt-2">{{ t('artworkJob.costBySuccess') }}</dd></div>
            </dl>
            <p class="text-sm leading-7 text-muted-foreground">{{ t('artworkJob.failureNote') }}</p>
            <Button class="h-auto min-h-9 whitespace-normal" :disabled="busy || (!offer && !pending) || (!!projectId && !project)" @click="generate"><Loader2 v-if="busy" class="mr-2 size-4 animate-spin" />{{ pending ? t('artworkJob.submitRetryBtn') : t('artworkJob.submitBtn') }}</Button>
          </CardContent></Card>
          <div v-if="!job && history.length" class="space-y-3"><h2 class="text-sm font-medium">{{ t('artworkJob.historyTitle') }}</h2><RouterLink v-for="item in history" :key="item.jobId" :to="{ path: `/artwork-jobs/${item.jobId}`, query: projectId ? { projectId } : {} }" class="flex items-center justify-between rounded-lg border px-4 py-3 text-sm"><span class="font-mono">{{ item.jobId.slice(0, 8) }}</span><span>{{ item.deliveryStatus === 'ready' ? t('artworkJob.historyComplete') : ['pending', 'queued', 'running', 'settling'].includes(item.status) ? t('artworkJob.historyProcessing') : t('artworkJob.historyIncomplete') }}</span><ArrowRight class="size-4" /></RouterLink></div>
          <template v-if="job">
            <div class="flex flex-wrap items-center justify-between gap-4"><div><p class="text-xs text-muted-foreground">{{ t('artworkJob.resultTitle') }}</p><h2 class="mt-2 flex items-center gap-2 text-xl font-medium"><Loader2 v-if="isRunning" class="size-5 animate-spin text-primary" /><CheckCircle2 v-else-if="ready" class="size-5 text-primary" />{{ isRunning ? t('artworkJob.resultProcessing') : ready ? t('artworkJob.resultComplete') : t('artworkJob.resultIncomplete') }}</h2><p class="mt-2 text-sm text-muted-foreground">{{ t('artworkJob.processingNote') }}{{ job.jobId.slice(0, 8) }}</p></div><Button variant="outline" @click="fetchJob()"><RefreshCw class="mr-2 size-4" />{{ t('artworkJob.refresh') }}</Button></div>
            <div class="grid gap-4 sm:grid-cols-2"><Card v-for="(item, index) in job.directions" :key="item.direction"><CardContent class="space-y-3 p-4"><div class="flex items-center justify-between"><h3 class="text-sm font-medium"><span class="mr-2 font-mono text-xs text-muted-foreground">0{{ index + 1 }}</span>{{ directionLabels[item.direction] }}</h3><StatusBadge domain="artwork" :status="item.status" /></div><div class="flex aspect-video items-center justify-center rounded-md bg-muted/40"><img v-if="item.previewUrl" :src="item.previewUrl" :alt="`${directionLabels[item.direction]}${t('artworkJob.directionImageLabel')}`" class="h-full w-full object-contain" @error="imageLinks.onImageError" /><Loader2 v-else-if="item.status !== 'failed'" class="size-7 animate-spin text-muted-foreground" /><p v-else class="px-5 text-center text-xs leading-6 text-muted-foreground">{{ reasonLabels[item.reason ?? ''] ?? t('artworkJob.directionFailed') }}</p></div><div class="flex items-center justify-between"><p class="text-xs text-muted-foreground">{{ item.width ? `${item.width} × ${item.height} px · PNG` : t('artworkJob.waitingFile') }}</p><Button v-if="item.assetId" variant="ghost" size="sm" :disabled="!!downloading" @click="download(item.assetId, item.direction)"><Download class="mr-1 size-3" />{{ t('artworkJob.downloadSingle') }}</Button></div></CardContent></Card></div>
            <Card><CardContent class="space-y-4 p-6"><div class="flex flex-wrap gap-x-6 gap-y-2 text-sm"><p>{{ t('artworkJob.creditPreoccupy', { amount: job.credits.reservedCredits }) }}</p><p>{{ t('artworkJob.creditFrozen', { amount: job.credits.heldCredits }) }}</p><p>{{ t('artworkJob.creditCharged', { amount: job.credits.chargedCredits }) }}</p><p>{{ t('artworkJob.creditReleased', { amount: job.credits.releasedCredits }) }}</p></div><p v-if="!isRunning && !ready" class="text-sm text-muted-foreground">{{ t('artworkJob.missingDirs', { dirs: job.missingDirections.map(d => directionLabels[d]).join('、') }) }}</p><div class="flex flex-wrap gap-3"><Button v-if="ready" :disabled="!!downloading" @click="download()"><Download class="mr-2 size-4" />{{ downloading === 'archive' ? t('artworkJob.zipPacking') : t('artworkJob.downloadZip') }}</Button><Button v-if="canBind" variant="outline" :disabled="busy" @click="bind"><Loader2 v-if="busy" class="mr-2 size-4 animate-spin" />{{ t('artworkJob.bindProject') }}</Button><span v-if="bound" class="flex items-center gap-2 text-sm text-primary"><CheckCircle2 class="size-4" />{{ t('artworkJob.boundProject') }}</span><Button v-if="ready && !projectId" variant="outline" as-child><RouterLink :to="{ path: `/schemes/${encodeURIComponent(job.schemeCode)}/quote`, query: { themeJobId: context.themeJobId, artworkJobId: job.jobId } }">{{ t('artworkJob.quoteWithArtwork') }}<ArrowRight class="ml-2 size-4" /></RouterLink></Button><Button v-if="!isRunning" variant="ghost" as-child><RouterLink :to="{ path: `/schemes/${encodeURIComponent(job.schemeCode)}/artwork`, query: { themeJobId: context.themeJobId, ...(projectId ? { projectId } : {}) } }">{{ t('artworkJob.regenerate') }}</RouterLink></Button></div></CardContent></Card>
          </template>
        </section>
      </div>
    </template>
  </main></MainLayout>
</template>
