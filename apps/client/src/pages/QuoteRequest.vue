<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CheckCircle2, FileText, Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import DatePickerInput from '@/components/ui/DatePickerInput.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import SelectionShell from '@/features/selection/SelectionShell.vue'
import { useAuthStore } from '@/stores/auth'
import { getQuoteContext, submitQuote, submitManualRequest, type ManualRequest, type QuoteContext, type QuoteRequest, type ProjectReceipt } from '@/services/api/projects'
import { getThemeJob } from '@/services/api/theme-jobs'
import { getArtworkJob } from '@/services/api/artwork-jobs'
import type { MatchItem, Requirement } from '@/features/selection/types'
import { apiFetch, lingtongPublicFetch } from '@/lib/api-client'
import type { SchemeDetail } from '@/features/selection/types'
import { emptyRequirement } from '@/features/selection/types'
import { scopeOptions as scopes } from '@/features/projects/labels'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const code = String(route.params.code)
const manual = route.name === 'ManualRequest'
const draftKey = manual ? 'booth:manual-draft' : `booth:quote-draft:${code}:${String(route.query.themeJobId ?? 'standard')}:${String(route.query.artworkJobId ?? 'pending')}`
const context = ref<QuoteContext | null>(null)
const theme = ref<QuoteRequest['themeSelection']>()
const themePreview = ref('')
const artworkJobId = ref<string>()
const standardPreview = ref('')
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const conflict = ref(false)
const receipt = ref<ProjectReceipt | null>(null)
const pending = ref<QuoteRequest | null>(null)
const pendingManual = ref<ManualRequest | null>(null)
const originalDescription = ref('')
const confirmedRequirements = ref(emptyRequirement())
const unresolvedQuestions = ref<string[]>([])
try {
  const stored = sessionStorage.getItem('booth:manual-context')
  if (manual && stored) {
    const data = JSON.parse(stored) as { originalDescription: string; confirmedRequirements: Requirement; unresolvedQuestions: string[] }
    originalDescription.value = data.originalDescription; confirmedRequirements.value = data.confirmedRequirements; unresolvedQuestions.value = data.unresolvedQuestions
  }
} catch { sessionStorage.removeItem('booth:manual-context') }
const requirementContext = ref<QuoteRequest['requirementContext']>()
const matchingSummary = ref<Pick<MatchItem, 'matchType' | 'differences' | 'pendingConfirmations'> | null>(null)
try {
  const stored = sessionStorage.getItem('booth-ai:ai-selection')
  if (stored) {
    const selection = JSON.parse(stored) as { version: number; requirement: Requirement; text: string; snapshot: string; liveMatchData?: { items: MatchItem[] } }
    if (selection.version === 2 && selection.snapshot === JSON.stringify({ requirement: selection.requirement, text: selection.text })) {
      const match = selection.liveMatchData?.items.find(item => item.code === code)
      if (match) { requirementContext.value = { originalDescription: selection.text, confirmedRequirements: selection.requirement }; matchingSummary.value = match }
    }
  }
} catch { requirementContext.value = undefined }
const user = auth.currentUser
const draftOwner = ref(user?.id ?? null)
const form = reactive({ exhibitionName: '', countryCode: 'CN', city: user?.city ?? '', startDate: '', endDate: '', scopeCodes: ['materials'], scopeNotes: '',
  currency: 'CNY', amount: '', customerType: (user?.company ? 'company' : 'individual') as 'company' | 'individual', company: user?.company ?? '',
  contactName: user?.nickname ?? user?.username ?? '', email: user?.email ?? '', phone: user?.mobile ?? '', notes: '' })
try {
  const saved = sessionStorage.getItem(draftKey)
  if (saved) {
    const draft = JSON.parse(saved) as { form: typeof form; pending: QuoteRequest | null; pendingManual?: ManualRequest | null; originalDescription?: string; confirmedRequirements?: Requirement; unresolvedQuestions?: string[]; receipt?: ProjectReceipt; owner: string | null }
    if (draft.owner === (user?.id ?? null) || (draft.owner === null && !draft.pending && !draft.pendingManual && !draft.receipt)) {
      Object.assign(form, draft.form); pending.value = draft.pending; pendingManual.value = draft.pendingManual ?? null; receipt.value = draft.receipt ?? null
      if (draft.originalDescription) originalDescription.value = draft.originalDescription
      if (draft.confirmedRequirements) confirmedRequirements.value = draft.confirmedRequirements
      if (draft.unresolvedQuestions) unresolvedQuestions.value = draft.unresolvedQuestions
    }
  }
} catch { sessionStorage.removeItem(draftKey) }
function persist() { sessionStorage.setItem(draftKey, JSON.stringify({ form, pending: pending.value, pendingManual: pendingManual.value, originalDescription: originalDescription.value, confirmedRequirements: confirmedRequirements.value, unresolvedQuestions: unresolvedQuestions.value, receipt: receipt.value, owner: draftOwner.value })) }
watch(form, persist, { deep: true })
watch(originalDescription, persist)
const frozen = computed(() => busy.value || pending.value !== null || pendingManual.value !== null)

interface DictItem { dictKey: string; dictValue: string; dictName: string }
interface DictResponse { data: DictItem[] }

const countryOptions = ref<DictItem[]>([])
const loadingCountries = ref(false)

async function loadCountries() {
  loadingCountries.value = true
  try {
    const res = await lingtongPublicFetch<DictResponse>('/api/systemDict/queryCountries', { query: { keyword: '' } })
    countryOptions.value = Array.isArray(res.data) ? res.data : []
  } catch { countryOptions.value = [] }
  finally { loadingCountries.value = false }
}

const cityOptions = ref<DictItem[]>([])
const loadingCities = ref(false)

async function loadCities(countryCode: string) {
  if (!countryCode) { cityOptions.value = []; return }
  loadingCities.value = true
  try {
    const res = await lingtongPublicFetch<DictResponse>('/api/systemDict/queryCities', { query: { countryCode, cityName: '' } })
    cityOptions.value = Array.isArray(res.data) ? res.data : []
  } catch { cityOptions.value = [] }
  finally { loadingCities.value = false }
}

watch(() => form.countryCode, (newCode) => {
  form.city = ''
  if (newCode) loadCities(newCode)
  else cityOptions.value = []
})

async function loadContext() {
  if (manual) { loading.value = false; return }
  loading.value = true
  error.value = ''
  theme.value = undefined
  artworkJobId.value = undefined
  try {
    context.value = await getQuoteContext(code)
    void apiFetch<{ code: number; data: SchemeDetail }>(`/api/v1/client/schemes/${encodeURIComponent(code)}`).then(response => {
      standardPreview.value = response.data.images[0]?.url ?? ''
    }).catch(() => { standardPreview.value = '' })
    if (typeof route.query.bomRevision === 'string' && Number(route.query.bomRevision) !== context.value.bomRevision) {
      conflict.value = true
      error.value = '您查看的清单已更新。请刷新资料并重新确认后提交。'
    }
    const jobId = route.query.themeJobId
    if (route.query.artworkJobId && typeof jobId !== 'string') throw new Error('素材必须关联主题')
    if (typeof jobId === 'string') {
      if (!auth.isLoggedIn) { context.value = null; error.value = '请先登录，以读取您选择的主题效果。'; return }
      const job = await getThemeJob(jobId)
      const result = job.results.find(result => result.resultId === job.selection.resultId)
      if (job.schemeCode !== code || !result) throw new Error('主题结果不可用')
      theme.value = { themeJobId: jobId, resultId: result.resultId, selectionRevision: job.selection.revision }
      themePreview.value = result.previewUrl
      if (typeof route.query.artworkJobId === 'string') {
        const artwork = await getArtworkJob(route.query.artworkJobId)
        if (artwork.deliveryStatus !== 'ready' || artwork.schemeCode !== code || artwork.themeSelection.themeJobId !== jobId || artwork.themeSelection.resultId !== result.resultId || artwork.themeSelection.selectionRevision !== job.selection.revision) throw new Error('素材与主题不一致')
        artworkJobId.value = artwork.jobId
      }
    }
  } catch { context.value = null; error.value = '方案或选定效果已变化，暂时无法申请，请返回确认后重试。' }
  finally { loading.value = false }
}
async function refreshContext() {
  await router.replace({ query: { ...route.query, bomRevision: undefined } })
  conflict.value = false
  await loadContext()
}
onMounted(loadContext)
onMounted(loadCountries)
onMounted(() => { if (form.countryCode) loadCities(form.countryCode) })
function login() { persist(); void router.push({ path: '/auth/sign-in', query: { redirect: route.fullPath } }) }
async function newRequest() { receipt.value = null; pending.value = null; pendingManual.value = null; persist(); await refreshContext() }
async function submit() {
  if (manual) { await submitManual(); return }
  if (busy.value || (!context.value && !pending.value)) return
  if (!auth.isLoggedIn) { login(); return }
  if (pending.value && draftOwner.value !== (auth.currentUser?.id ?? null)) { pending.value = null; error.value = '登录账户已变化，请重新确认本次申请。'; persist(); return }
  draftOwner.value = auth.currentUser?.id ?? null
  error.value = ''
  if (!pending.value) {
    if (!form.scopeCodes.length || (!form.email.trim() && !form.phone.trim()) || (form.scopeCodes.includes('other') && !form.scopeNotes.trim())) { error.value = '请选择需求范围，并填写邮箱或电话；其他范围请补充说明。'; return }
    const current = context.value!
    pending.value = { requestKey: crypto.randomUUID(), schemeCode: code, schemeRevision: current.schemeRevision,
      ...(current.bomRevision ? { bomRevision: current.bomRevision } : {}), ...(current.drawingRevision ? { drawingRevision: current.drawingRevision } : {}),
      ...(!theme.value && current.artworkRevision ? { artworkRevision: current.artworkRevision } : {}), ...(theme.value ? { themeSelection: theme.value } : {}),
      ...(artworkJobId.value ? { artworkJobId: artworkJobId.value } : {}),
      entryPoint: theme.value ? 'theme_result' : route.query.entryPoint === 'bill_of_materials' ? 'bill_of_materials' : 'scheme_detail',
      exhibition: { name: form.exhibitionName, countryCode: form.countryCode.toUpperCase(), city: form.city, startDate: form.startDate, endDate: form.endDate },
      scopeCodes: [...form.scopeCodes], scopeNotes: form.scopeNotes, materialBudget: { currency: form.currency, amount: form.amount }, customerType: form.customerType, company: form.company,
      contact: { name: form.contactName, ...(form.email.trim() ? { email: form.email.trim() } : {}), ...(form.phone.trim() ? { phone: form.phone.trim() } : {}) }, notes: form.notes }
    if (requirementContext.value) pending.value.requirementContext = requirementContext.value
    persist()
  }
  busy.value = true
  try { receipt.value = await submitQuote(pending.value); pending.value = null; persist() }
  catch (failure: unknown) {
    const status = (failure as { response?: { status?: number } }).response?.status
    if (status && status < 500 && status !== 408 && status !== 429) {
      pending.value = null
      conflict.value = status === 409
      error.value = status === 409 ? '资料或主题选择已更新。您的表单已保留，请刷新资料并确认后再提交。' : status === 401 ? '登录已失效，请重新登录后提交。' : '请核对日期、正数材料预算、企业名称和联系方式后重试。'
    } else { error.value = '暂未确认受理结果，已保留本次提交。请用下方按钮重试确认，避免重复创建项目。' }
    persist()
  } finally { busy.value = false }
}
async function submitManual() {
  if (busy.value) return
  if (!auth.isLoggedIn) { login(); return }
  if (pendingManual.value && draftOwner.value !== (auth.currentUser?.id ?? null)) { pendingManual.value = null; error.value = '登录账户已变化，请重新确认。'; persist(); return }
  draftOwner.value = auth.currentUser?.id ?? null
  if (!pendingManual.value) {
    if (!originalDescription.value.trim() || !form.scopeCodes.length || (!form.email.trim() && !form.phone.trim())) { error.value = '请填写原始需求、需求范围及邮箱或电话。'; return }
    pendingManual.value = { requestKey: crypto.randomUUID(), originalDescription: originalDescription.value, confirmedRequirements: confirmedRequirements.value,
      unresolvedQuestions: unresolvedQuestions.value, entryPoint: 'matching_results', exhibition: { name: form.exhibitionName, countryCode: form.countryCode.toUpperCase(), city: form.city, startDate: form.startDate, endDate: form.endDate },
      scopeCodes: [...form.scopeCodes], scopeNotes: form.scopeNotes, materialBudget: { currency: form.currency, amount: form.amount }, customerType: form.customerType, company: form.company,
      contact: { name: form.contactName, ...(form.email.trim() ? { email: form.email.trim() } : {}), ...(form.phone.trim() ? { phone: form.phone.trim() } : {}) }, notes: form.notes }
    persist()
  }
  busy.value = true; error.value = ''
  try { receipt.value = await submitManualRequest(pendingManual.value); pendingManual.value = null; persist() }
  catch (failure: unknown) {
    const status = (failure as { response?: { status?: number } }).response?.status
    if (status && status < 500 && status !== 408 && status !== 429) { pendingManual.value = null; error.value = '请核对日期、预算、联系方式及登录状态，填写内容已保留。' }
    else error.value = '暂未确认受理结果，请重试确认本次申请。'
    persist()
  } finally { busy.value = false }
}
</script>

<template>
  <SelectionShell><main class="container mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-6">
    <Button variant="ghost" as-child><RouterLink :to="manual ? '/ai-selection' : `/schemes/${encodeURIComponent(code)}`"><ArrowLeft class="mr-2 size-4" />{{ manual ? '返回智选' : '返回方案' }}</RouterLink></Button>
    <template v-if="receipt">
      <Card class="border-primary/30"><CardContent class="space-y-6 p-8 md:p-12">
        <CheckCircle2 class="size-12 text-primary" /><div><p class="mb-2 text-sm text-muted-foreground">申请已受理</p><h1 class="text-3xl font-semibold">您的展台项目已建立</h1></div>
        <dl class="grid gap-4 rounded-lg bg-muted p-5 sm:grid-cols-2"><div><dt class="text-sm text-muted-foreground">项目编号</dt><dd class="mt-1 font-mono text-xl">{{ receipt.projectNo }}</dd></div><div><dt class="text-sm text-muted-foreground">申请编号</dt><dd class="mt-1 break-all font-mono text-sm">{{ receipt.requestNo }}</dd></div></dl>
        <p class="text-sm leading-6 text-muted-foreground">管理人员将根据本次申请联系您，核对需求后提供人工报价。当前状态为待跟进，受理回执不代表已出具报价。</p>
        <p v-if="receipt.materialsStatus?.artworks === 'pending'" class="text-sm">已固定您选择的主题效果，配套平面素材待补充。</p>
        <p v-if="artworkJobId && receipt.materialsStatus?.artworks === 'available'" class="text-sm">四面素材已固定到项目，可从项目详情查看与下载。</p>
        <Button as-child><RouterLink :to="`/my-projects/${receipt.projectId}`">查看我的项目</RouterLink></Button>
        <Button variant="outline" class="ml-3" @click="newRequest">填写另一份申请</Button>
      </CardContent></Card>
    </template>
    <template v-else>
      <header class="space-y-2"><p class="text-sm font-medium text-primary">项目申请 / {{ manual ? '人工需求' : '报价服务' }}</p><h1 class="text-3xl font-semibold tracking-tight">{{ manual ? '特别的需求，交给专业的人' : '让方案进入您的展会' }}</h1><p class="text-sm text-muted-foreground">填写实际需求，交由管理人员核对并人工报价。</p></header>
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <form class="space-y-5" @submit.prevent="submit">
          <fieldset :disabled="frozen" class="space-y-5">
            <Card v-if="manual"><CardHeader><CardTitle class="text-lg">需求描述</CardTitle></CardHeader><CardContent class="space-y-3"><Textarea v-model="originalDescription" required maxlength="5000" class="min-h-32" aria-label="原始需求描述" placeholder="描述展位尺寸、功能、风格和需要确认的问题" /><p v-for="question in unresolvedQuestions" :key="question" class="text-xs text-muted-foreground">待确认：{{ question }}</p><p class="text-xs text-muted-foreground">本次申请不指定方案；沟通确认后由管理人员关联并固定资料。</p></CardContent></Card>
            <Card><CardHeader><CardTitle class="text-lg">01 / 展会信息</CardTitle></CardHeader><CardContent class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-2 sm:col-span-2"><Label for="exhibition">展会名称 *</Label><Input id="exhibition" v-model="form.exhibitionName" required maxlength="200" /></div>
              <!-- 国家代码 -->
              <div class="space-y-2">
                <Label for="country">国家代码 *</Label>
                <Select
                  :model-value="form.countryCode"
                  :disabled="loadingCountries || frozen"
                  required
                  @update:model-value="form.countryCode = $event"
                >
                  <SelectTrigger id="country" class="w-full">
                    <SelectValue :placeholder="loadingCountries ? '加载中…' : '选择国家'" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="item in countryOptions"
                      :key="item.dictKey"
                      :value="item.dictKey"
                    >
                      {{ item.dictKey }} · {{ item.dictValue }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <!-- 城市 -->
              <div class="space-y-2">
                <Label for="city">城市 *</Label>
                <Select
                  :model-value="form.city"
                  :disabled="!form.countryCode || loadingCities || frozen"
                  required
                  @update:model-value="form.city = $event"
                >
                  <SelectTrigger id="city" class="w-full">
                    <SelectValue :placeholder="loadingCities ? '加载中…' : (form.countryCode ? '选择城市' : '请先选择国家')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="item in cityOptions"
                      :key="item.dictValue"
                      :value="item.dictValue"
                    >
                      {{ item.dictValue }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-2"><Label>开展日期 *</Label><DatePickerInput v-model="form.startDate" placeholder="选择开展日期" required /></div>
              <div class="space-y-2"><Label>结束日期 *</Label><DatePickerInput v-model="form.endDate" :min="form.startDate" placeholder="选择结束日期" required /></div>
            </CardContent></Card>
            <Card><CardHeader><CardTitle class="text-lg">02 / 需求与材料预算</CardTitle></CardHeader><CardContent class="space-y-4">
              <div class="flex flex-wrap gap-4"><label v-for="scope in scopes" :key="scope.code" class="flex items-center gap-2 text-sm cursor-pointer"><Checkbox :checked="form.scopeCodes.includes(scope.code)" @update:checked="(v) => { if (v) form.scopeCodes.push(scope.code); else form.scopeCodes = form.scopeCodes.filter(c => c !== scope.code) }" />{{ scope.label }}</label></div>
              <div class="space-y-2"><Label for="scope">范围说明{{ form.scopeCodes.includes('other') ? ' *' : '' }}</Label><Textarea id="scope" v-model="form.scopeNotes" :required="form.scopeCodes.includes('other')" maxlength="2000" /></div>
              <div class="grid gap-4 sm:grid-cols-[120px_1fr]"><div class="space-y-2"><Label for="currency">币种 *</Label><Select :model-value="form.currency" @update:model-value="form.currency = $event"><SelectTrigger id="currency"><SelectValue placeholder="选择币种" /></SelectTrigger><SelectContent><SelectItem v-for="currency in ['CNY','USD','EUR','GBP','HKD','JPY','KRW','KWD']" :key="currency" :value="currency">{{ currency }}</SelectItem></SelectContent></Select></div><div class="space-y-2"><Label for="budget">材料购买预算 *</Label><Input id="budget" v-model="form.amount" required inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?" placeholder="如 30000" /></div></div>
              <p class="text-xs text-muted-foreground">预算仅用于需求沟通，不等于报价；运输、搭建及税费由人工另行确认。</p>
            </CardContent></Card>
            <Card><CardHeader><CardTitle class="text-lg">03 / 联系方式</CardTitle></CardHeader><CardContent class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-2"><Label for="customer-type">客户类型 *</Label><Select :model-value="form.customerType" @update:model-value="form.customerType = $event as 'company' | 'individual'"><SelectTrigger id="customer-type"><SelectValue placeholder="选择类型" /></SelectTrigger><SelectContent><SelectItem value="individual">个人</SelectItem><SelectItem value="company">企业</SelectItem></SelectContent></Select></div>
              <div class="space-y-2"><Label for="company">企业名称{{ form.customerType === 'company' ? ' *' : '' }}</Label><Input id="company" v-model="form.company" :required="form.customerType === 'company'" maxlength="200" /></div>
              <div class="space-y-2 sm:col-span-2"><Label for="contact">联系人 *</Label><Input id="contact" v-model="form.contactName" required maxlength="100" autocomplete="name" /></div>
              <div class="space-y-2"><Label for="email">邮箱（与电话至少一项）</Label><Input id="email" v-model="form.email" type="email" maxlength="254" autocomplete="email" /></div>
              <div class="space-y-2"><Label for="phone">电话（支持国际区号）</Label><Input id="phone" v-model="form.phone" type="tel" maxlength="30" autocomplete="tel" /></div>
              <div class="space-y-2 sm:col-span-2"><Label for="notes">补充说明</Label><Textarea id="notes" v-model="form.notes" maxlength="2000" /></div>
            </CardContent></Card>
          </fieldset>
          <p v-if="error" role="alert" class="rounded-md border border-destructive/30 p-4 text-sm text-destructive">{{ error }}</p>
          <Button v-if="conflict" type="button" variant="outline" @click="refreshContext">刷新资料并重新确认</Button>
          <Button v-if="!auth.isLoggedIn" type="button" @click="login">登录后提交申请</Button>
          <Button v-else :disabled="busy || loading || (!manual && !pending && (!context || conflict))" type="submit" class="w-full sm:w-auto"><Loader2 v-if="busy" class="mr-2 size-4 animate-spin" />{{ busy ? '正在确认受理…' : pending || pendingManual ? '重试确认本次申请' : manual ? '确认并提交人工需求' : '确认并提交报价申请' }}</Button>
        </form>
        <aside class="space-y-4 lg:sticky lg:top-6"><Card><CardHeader><FileText class="size-6 text-primary" /><CardTitle class="text-base">{{ manual ? '人工需求承接' : '本次申请方案' }}</CardTitle></CardHeader><CardContent class="space-y-4 text-sm">
          <p v-if="!manual" class="break-all font-mono">{{ code }}</p><p v-else>原文与确认条件分别保存。提交后建立项目，由管理员联系并核对适用方案。</p><p v-if="loading" class="text-muted-foreground">读取方案资料…</p>
          <template v-else-if="context"><p>清单修订 {{ context.bomRevision }} · 方案修订 {{ context.schemeRevision }}</p><img v-if="themePreview || standardPreview" :src="themePreview || standardPreview" :alt="theme ? '本次选定主题效果' : '标准方案效果'" class="aspect-video w-full rounded-md object-contain" /><p>{{ theme ? '已带入您选择的主题效果' : '使用标准方案效果' }}</p><p v-if="theme" class="text-xs text-muted-foreground">主题平面素材尚待补充，不以标准素材代替。</p></template>
          <div v-if="matchingSummary" class="space-y-2 border-t pt-4 text-xs"><p class="font-medium">{{ matchingSummary.matchType === 'direct' ? '匹配条件已带入' : '参考方案 · 适用性需确认' }}</p><p v-for="difference in matchingSummary.differences" :key="difference.field">{{ difference.requested }} → {{ difference.actual }}：{{ difference.reason }}</p><p v-for="confirmation in matchingSummary.pendingConfirmations" :key="confirmation.message">{{ confirmation.message }}</p></div>
          <p class="border-t pt-4 text-xs leading-6 text-muted-foreground">提交时将固定当前资料。方案适用性、场馆规范和交付范围需经专业确认。</p>
        </CardContent></Card></aside>
      </div>
    </template>
  </main></SelectionShell>
</template>
