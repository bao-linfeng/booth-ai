<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { parseDate } from '@internationalized/date'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, CheckCircle2, FileText, Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import DatePickerInput from '@/components/ui/DatePickerInput.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import MainLayout from '@/layouts/MainLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { getQuoteContext, submitQuote, type QuoteContext, type QuoteRequest, type ProjectReceipt } from '@/services/api/quote-requests'
import { submitManualRequest, type ManualRequest } from '@/services/api/manual-requests'
import { getThemeJob } from '@/services/api/theme-jobs'
import { getArtworkJob } from '@/services/api/artwork-jobs'
import type { Requirement } from '@/features/selection/types'
import { manualDraftKey, readManualHandoff, readSelectionQuoteHandoff } from '@/features/selection/handoff'
import { apiFetch, lingtongPublicFetch } from '@/lib/api-client'
import type { SchemeDetail } from '@/features/selection/types'
import { emptyRequirement } from '@/features/selection/types'
import { getScopeOptions } from '@/features/projects/labels'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const scopes = computed(() => getScopeOptions(t))
const auth = useAuthStore()
const code = String(route.params.code)
const manual = route.name === 'ManualRequest'
const draftKey = manual ? manualDraftKey : `booth:quote-draft:${code}:${String(route.query.themeJobId ?? 'standard')}:${String(route.query.artworkJobId ?? 'pending')}`
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
const manualHandoff = manual ? readManualHandoff() : null
const originalDescription = ref(manualHandoff?.originalDescription ?? '')
const confirmedRequirements = ref(manualHandoff?.confirmedRequirements ?? emptyRequirement())
const unresolvedQuestions = ref(manualHandoff?.unresolvedQuestions ?? [])
const selectionHandoff = manual ? null : readSelectionQuoteHandoff(code, typeof route.query.searchId === 'string' ? route.query.searchId : undefined)
const requirementContext = selectionHandoff?.requirementContext
const matchingSummary = selectionHandoff?.matchingSummary ?? null
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
const validationAttempted = ref(false)
const descriptionError = computed(() => validationAttempted.value && manual && !originalDescription.value.trim() ? t('quoteRequest.validationRequirement') : '')
function dateError(value: string, key: 'validationStartDate' | 'validationEndDate') {
  const label = t(`quoteRequest.${key}`)
  if (!value) return t('quoteRequest.validationSelect', { label })
  try { if (parseDate(value).toString() === value) return '' } catch {}
  return t('quoteRequest.validationInvalid', { label })
}
const startDateError = computed(() => validationAttempted.value ? dateError(form.startDate, 'validationStartDate') : '')
const endDateError = computed(() => {
  if (!validationAttempted.value) return ''
  const invalid = dateError(form.endDate, 'validationEndDate')
  if (invalid) return invalid
  return !startDateError.value && form.endDate < form.startDate ? t('quoteRequest.validationDateRange') : ''
})
const scopeError = computed(() => validationAttempted.value && !form.scopeCodes.length ? t('quoteRequest.validationScope') : '')
const scopeNotesError = computed(() => validationAttempted.value && form.scopeCodes.includes('other') && !form.scopeNotes.trim() ? t('quoteRequest.validationScopeNote') : '')
// 未登录提交以邮箱认领：登录后，灵通账号邮箱与此一致的申请会自动归入"我的项目"
const contactError = computed(() => {
  if (!validationAttempted.value) return ''
  if (!auth.isLoggedIn && !form.email.trim()) return t('quoteRequest.validationEmailRequired')
  return !form.email.trim() && !form.phone.trim() ? t('quoteRequest.validationContact') : ''
})

function validateFields() {
  validationAttempted.value = true
  if (!descriptionError.value && !startDateError.value && !endDateError.value && !scopeError.value && !scopeNotesError.value && !contactError.value) return true
  const selector = descriptionError.value ? '#request-description' : startDateError.value ? '#request-start-date' : endDateError.value ? '#request-end-date' : scopeError.value ? '#request-scopes button' : scopeNotesError.value ? '#scope' : '#email'
  void nextTick(() => document.querySelector<HTMLElement>(selector)?.focus())
  return false
}

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
      error.value = t('quoteRequest.errorBomStale')
    }
    const jobId = route.query.themeJobId
    if (route.query.artworkJobId && typeof jobId !== 'string') throw new Error(t('quoteRequest.errorArtworkNoTheme'))
    if (typeof jobId === 'string') {
       if (!auth.isLoggedIn) { context.value = null; error.value = t('quoteRequest.errorLoginRequired'); return }
      const job = await getThemeJob(jobId)
      const result = job.results.find(result => result.resultId === job.selection.resultId)
       if (job.schemeCode !== code || !result) throw new Error(t('quoteRequest.errorThemeUnavailable'))
      theme.value = { themeJobId: jobId, resultId: result.resultId, selectionRevision: job.selection.revision }
      themePreview.value = result.previewUrl
      if (typeof route.query.artworkJobId === 'string') {
        const artwork = await getArtworkJob(route.query.artworkJobId)
         if (artwork.deliveryStatus !== 'ready' || artwork.schemeCode !== code || artwork.themeSelection.themeJobId !== jobId || artwork.themeSelection.resultId !== result.resultId || artwork.themeSelection.selectionRevision !== job.selection.revision) throw new Error(t('quoteRequest.errorArtworkThemeMismatch'))
        artworkJobId.value = artwork.jobId
      }
    }
  } catch { context.value = null; error.value = t('quoteRequest.errorSchemeChanged') }
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
function login() { persist(); void router.push({ path: '/auth/sign-in', query: { redirect: receipt.value ? '/my-projects' : route.fullPath } }) }
async function newRequest() { receipt.value = null; pending.value = null; pendingManual.value = null; persist(); await refreshContext() }
async function submit() {
  if (manual) { await submitManual(); return }
  if (busy.value || (!context.value && !pending.value)) return
  if (pending.value && draftOwner.value !== (auth.currentUser?.id ?? null)) { pending.value = null; error.value = t('quoteRequest.errorAccountChanged'); persist(); return }
  draftOwner.value = auth.currentUser?.id ?? null
  error.value = ''
  if (!pending.value) {
    if (!validateFields()) return
    const current = context.value!
    pending.value = { requestKey: crypto.randomUUID(), schemeCode: code, schemeRevision: current.schemeRevision,
      ...(current.bomRevision ? { bomRevision: current.bomRevision } : {}), ...(current.drawingRevision ? { drawingRevision: current.drawingRevision } : {}),
      ...(!theme.value && current.artworkRevision ? { artworkRevision: current.artworkRevision } : {}), ...(theme.value ? { themeSelection: theme.value } : {}),
      ...(artworkJobId.value ? { artworkJobId: artworkJobId.value } : {}),
      entryPoint: theme.value ? 'theme_result' : route.query.entryPoint === 'bill_of_materials' ? 'bill_of_materials' : 'scheme_detail',
      exhibition: { name: form.exhibitionName, countryCode: form.countryCode.toUpperCase(), city: form.city, startDate: form.startDate, endDate: form.endDate },
      scopeCodes: [...form.scopeCodes], scopeNotes: form.scopeNotes, materialBudget: { currency: form.currency, amount: form.amount }, customerType: form.customerType, company: form.company,
      contact: { name: form.contactName, ...(form.email.trim() ? { email: form.email.trim() } : {}), ...(form.phone.trim() ? { phone: form.phone.trim() } : {}) }, notes: form.notes }
    if (requirementContext) pending.value.requirementContext = requirementContext
    persist()
  }
  busy.value = true
  try { receipt.value = await submitQuote(pending.value); pending.value = null; persist() }
  catch (failure: unknown) {
    const status = (failure as { response?: { status?: number } }).response?.status
    const reason = (failure as { data?: { error?: { reason?: string } } }).data?.error?.reason
    if (status === 503 && reason === 'ASSIGNMENT_UNAVAILABLE') {
      pending.value = null
      error.value = t('quoteRequest.errorAssignmentUnavailable')
    } else if (status && status < 500 && status !== 408 && status !== 429) {
      pending.value = null
      conflict.value = status === 409
      error.value = status === 409 ? t('quoteRequest.errorDataChanged') : status === 401 ? t('quoteRequest.errorAuthFailed') : reason === 'CLAIM_EMAIL_REQUIRED' ? t('quoteRequest.validationEmailRequired') : t('quoteRequest.errorFormInvalid')
    } else { error.value = t('quoteRequest.errorNetworkSubmit') }
    persist()
  } finally { busy.value = false }
}
async function submitManual() {
  if (busy.value) return
  if (pendingManual.value && draftOwner.value !== (auth.currentUser?.id ?? null)) { pendingManual.value = null; error.value = t('quoteRequest.errorAccountChanged2'); persist(); return }
  draftOwner.value = auth.currentUser?.id ?? null
  error.value = ''
  if (!pendingManual.value) {
    if (!validateFields()) return
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
    const reason = (failure as { data?: { error?: { reason?: string } } }).data?.error?.reason
    if (status === 503 && reason === 'ASSIGNMENT_UNAVAILABLE') { pendingManual.value = null; error.value = t('quoteRequest.errorAssignmentUnavailable') }
    else if (status && status < 500 && status !== 408 && status !== 429) { pendingManual.value = null; error.value = status === 401 ? t('quoteRequest.errorAuthFailed') : reason === 'CLAIM_EMAIL_REQUIRED' ? t('quoteRequest.validationEmailRequired') : t('quoteRequest.errorFormInvalid2') }
    else error.value = t('quoteRequest.errorNetworkRetry')
    persist()
  } finally { busy.value = false }
}
</script>

<template>
  <MainLayout><main id="main-content" class="studio-page">
    <Button variant="ghost" as-child><RouterLink :to="manual ? '/ai-selection' : `/schemes/${encodeURIComponent(code)}`"><ArrowLeft class="mr-2 size-4" />{{ manual ? t('quoteRequest.backToSelection') : t('quoteRequest.backToScheme') }}</RouterLink></Button>
    <template v-if="receipt">
      <Card class="border-success/25"><CardContent class="space-y-6 p-6 md:p-12">
        <CheckCircle2 class="size-12 text-success" /><div><p class="mb-2 text-sm text-success">{{ t('quoteRequest.successTitle') }}</p><h1 class="studio-title">{{ t('quoteRequest.successSubtitle') }}</h1></div>
        <dl class="grid gap-4 rounded-lg bg-muted p-5 sm:grid-cols-2"><div><dt class="text-sm text-muted-foreground">{{ t('quoteRequest.successProjectId') }}</dt><dd class="mt-1 font-mono text-xl">{{ receipt.projectNo }}</dd></div><div><dt class="text-sm text-muted-foreground">{{ t('quoteRequest.successRequestId') }}</dt><dd class="mt-1 break-all font-mono text-sm">{{ receipt.requestNo }}</dd></div></dl>
        <p class="text-sm leading-6 text-muted-foreground">{{ t('quoteRequest.successNote') }}</p>
        <p v-if="receipt.materialsStatus?.artworks === 'pending'" class="text-sm">{{ t('quoteRequest.successThemePending') }}</p>
        <p v-if="artworkJobId && receipt.materialsStatus?.artworks === 'available'" class="text-sm">{{ t('quoteRequest.successArtworkFixed') }}</p>
        <template v-if="auth.isLoggedIn"><Button as-child><RouterLink :to="`/my-projects/${receipt.projectId}`">{{ t('quoteRequest.viewProjects') }}</RouterLink></Button></template>
        <template v-else><p class="text-sm leading-6">{{ t('quoteRequest.successGuestNote', { email: form.email.trim() }) }}</p><Button @click="login">{{ t('quoteRequest.loginToTrack') }}</Button></template>
        <Button variant="outline" class="ml-3" @click="newRequest">{{ t('quoteRequest.submitAnother') }}</Button>
      </CardContent></Card>
    </template>
    <template v-else>
      <header class="studio-header"><p class="studio-eyebrow">{{ t('quoteRequest.pageTitle') }}{{ manual ? t('quoteRequest.typeManual') : t('quoteRequest.typeQuote') }}</p><h1 class="studio-title">{{ manual ? t('quoteRequest.headingManual') : t('quoteRequest.headingQuote') }}</h1><p class="text-base text-muted-foreground">{{ t('quoteRequest.formDesc') }}</p></header>
      <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <form class="space-y-5" @submit.prevent="submit">
          <fieldset :disabled="frozen" class="studio-panel min-w-0 divide-y">
            <section v-if="manual"><CardHeader><CardTitle class="text-lg">{{ t('quoteRequest.requirementTitle') }}</CardTitle></CardHeader><CardContent class="space-y-3"><Textarea id="request-description" v-model="originalDescription" required maxlength="5000" class="min-h-32" :aria-label="t('quoteRequest.requirementTitle')" :aria-invalid="!!descriptionError" :aria-describedby="descriptionError ? 'request-description-error' : undefined" :placeholder="t('quoteRequest.requirementPlaceholder')" /><p v-if="descriptionError" id="request-description-error" role="alert" class="text-sm text-destructive">{{ descriptionError }}</p><p v-for="question in unresolvedQuestions" :key="question" class="text-sm text-warning">{{ t('quoteRequest.pendingConfirm') }}{{ question }}</p><p class="text-sm text-muted-foreground">{{ t('quoteRequest.manualNote') }}</p></CardContent></section>
            <section><CardHeader><CardTitle class="text-lg">{{ t('quoteRequest.section1') }}</CardTitle></CardHeader><CardContent class="grid gap-5 sm:grid-cols-2">
              <div class="space-y-2 sm:col-span-2"><Label for="exhibition">{{ t('quoteRequest.exhibitionName') }}</Label><Input id="exhibition" v-model="form.exhibitionName" required maxlength="200" /></div>
              <!-- 国家代码 -->
              <div class="space-y-2">
                <Label for="country">{{ t('quoteRequest.countryCode') }}</Label>
                <Select
                  :model-value="form.countryCode"
                  :disabled="loadingCountries || frozen"
                  required
                  @update:model-value="form.countryCode = $event"
                >
                  <SelectTrigger id="country" class="w-full">
                    <SelectValue :placeholder="loadingCountries ? t('quoteRequest.countryLoading') : t('quoteRequest.countryPlaceholder')" />
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
                <Label for="city">{{ t('quoteRequest.cityLabel') }}</Label>
                <Select
                  :model-value="form.city"
                  :disabled="!form.countryCode || loadingCities || frozen"
                  required
                  @update:model-value="form.city = $event"
                >
                  <SelectTrigger id="city" class="w-full">
                    <SelectValue :placeholder="loadingCities ? t('quoteRequest.countryLoading') : (form.countryCode ? t('quoteRequest.cityLoadingOrSelect') : t('quoteRequest.cityWaitCountry'))" />
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
              <div class="space-y-2"><Label for="request-start-date">{{ t('quoteRequest.startDate') }}</Label><DatePickerInput id="request-start-date" v-model="form.startDate" :placeholder="t('quoteRequest.startDatePlaceholder')" required :aria-invalid="!!startDateError" :aria-describedby="startDateError ? 'request-start-date-error' : undefined" /><p v-if="startDateError" id="request-start-date-error" role="alert" class="text-sm text-destructive">{{ startDateError }}</p></div>
              <div class="space-y-2"><Label for="request-end-date">{{ t('quoteRequest.endDate') }}</Label><DatePickerInput id="request-end-date" v-model="form.endDate" :min="form.startDate" :placeholder="t('quoteRequest.endDatePlaceholder')" required :aria-invalid="!!endDateError" :aria-describedby="endDateError ? 'request-end-date-error' : undefined" /><p v-if="endDateError" id="request-end-date-error" role="alert" class="text-sm text-destructive">{{ endDateError }}</p></div>
            </CardContent></section>
            <section><CardHeader><CardTitle class="text-lg">{{ t('quoteRequest.section2') }}</CardTitle></CardHeader><CardContent class="space-y-5">
              <div class="space-y-2"><p id="request-scopes-label" class="text-sm font-medium">{{ t('quoteRequest.scopeLabel') }}</p><div id="request-scopes" role="group" aria-labelledby="request-scopes-label" :aria-describedby="scopeError ? 'request-scopes-error' : undefined" class="flex flex-wrap gap-4"><label v-for="scope in scopes" :key="scope.code" class="flex items-center gap-2 text-sm cursor-pointer"><Checkbox :checked="form.scopeCodes.includes(scope.code)" :aria-invalid="!!scopeError" :aria-describedby="scopeError ? 'request-scopes-error' : undefined" @update:checked="(v) => { if (v) form.scopeCodes.push(scope.code); else form.scopeCodes = form.scopeCodes.filter(c => c !== scope.code) }" />{{ scope.label }}</label></div><p v-if="scopeError" id="request-scopes-error" role="alert" class="text-sm text-destructive">{{ scopeError }}</p></div>
              <div class="space-y-2"><Label for="scope">{{ t('quoteRequest.scopeNote') }}{{ form.scopeCodes.includes('other') ? ' *' : '' }}</Label><Textarea id="scope" v-model="form.scopeNotes" :required="form.scopeCodes.includes('other')" maxlength="2000" :aria-invalid="!!scopeNotesError" :aria-describedby="scopeNotesError ? 'request-scope-notes-error' : undefined" /><p v-if="scopeNotesError" id="request-scope-notes-error" role="alert" class="text-sm text-destructive">{{ scopeNotesError }}</p></div>
              <div class="grid gap-4 sm:grid-cols-[120px_1fr]"><div class="space-y-2"><Label for="currency">{{ t('quoteRequest.currencyLabel') }}</Label><Select :model-value="form.currency" @update:model-value="form.currency = $event"><SelectTrigger id="currency"><SelectValue :placeholder="t('quoteRequest.currencyPlaceholder')" /></SelectTrigger><SelectContent><SelectItem v-for="currency in ['CNY','USD','EUR','GBP','HKD','JPY','KRW','KWD']" :key="currency" :value="currency">{{ currency }}</SelectItem></SelectContent></Select></div><div class="space-y-2"><Label for="budget">{{ t('quoteRequest.budgetLabel') }}</Label><Input id="budget" v-model="form.amount" required inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?" :placeholder="t('quoteRequest.budgetPlaceholder')" /></div></div>
              <p class="studio-note">{{ t('quoteRequest.budgetNote') }}</p>
            </CardContent></section>
            <section><CardHeader><CardTitle class="text-lg">{{ t('quoteRequest.section3') }}</CardTitle></CardHeader><CardContent class="grid gap-5 sm:grid-cols-2">
              <div class="space-y-2"><Label for="customer-type">{{ t('quoteRequest.clientTypeLabel') }}</Label><Select :model-value="form.customerType" @update:model-value="form.customerType = $event as 'company' | 'individual'"><SelectTrigger id="customer-type"><SelectValue :placeholder="t('quoteRequest.clientTypePlaceholder')" /></SelectTrigger><SelectContent><SelectItem value="individual">{{ t('quoteRequest.clientTypePersonal') }}</SelectItem><SelectItem value="company">{{ t('quoteRequest.clientTypeEnterprise') }}</SelectItem></SelectContent></Select></div>
              <div class="space-y-2"><Label for="company">{{ t('quoteRequest.enterpriseName') }}{{ form.customerType === 'company' ? ' *' : '' }}</Label><Input id="company" v-model="form.company" :required="form.customerType === 'company'" maxlength="200" /></div>
              <div class="space-y-2 sm:col-span-2"><Label for="contact">{{ t('quoteRequest.contactName') }}</Label><Input id="contact" v-model="form.contactName" required maxlength="100" autocomplete="name" /></div>
              <div class="space-y-2"><Label for="email">{{ t('quoteRequest.emailLabel') }}</Label><Input id="email" v-model="form.email" type="email" maxlength="254" autocomplete="email" :aria-invalid="!!contactError" :aria-describedby="contactError ? 'request-contact-error' : undefined" /></div>
              <div class="space-y-2"><Label for="phone">{{ t('quoteRequest.phoneLabel') }}</Label><Input id="phone" v-model="form.phone" type="tel" maxlength="30" autocomplete="tel" :aria-invalid="!!contactError" :aria-describedby="contactError ? 'request-contact-error' : undefined" /></div>
              <p v-if="contactError" id="request-contact-error" role="alert" class="text-sm text-destructive sm:col-span-2">{{ contactError }}</p>
              <p v-else-if="!auth.isLoggedIn" class="text-sm text-muted-foreground sm:col-span-2">{{ t('quoteRequest.guestHint') }}</p>
              <div class="space-y-2 sm:col-span-2"><Label for="notes">{{ t('quoteRequest.remarksLabel') }}</Label><Textarea id="notes" v-model="form.notes" maxlength="2000" /></div>
            </CardContent></section>
          </fieldset>
          <p v-if="error" role="alert" class="rounded-md border border-destructive/30 p-4 text-sm text-destructive">{{ error }}</p>
          <Button v-if="conflict" type="button" variant="outline" @click="refreshContext">{{ t('quoteRequest.refreshAndConfirm') }}</Button>
          <Button :disabled="busy || loading || (!manual && !pending && (!context || conflict))" type="submit" class="w-full sm:w-auto"><Loader2 v-if="busy" class="mr-2 size-4 animate-spin" />{{ busy ? t('quoteRequest.submitting') : pending || pendingManual ? t('quoteRequest.retrySubmit') : manual ? t('quoteRequest.submitManual') : t('quoteRequest.submitQuote') }}</Button>
          <Button v-if="!auth.isLoggedIn" type="button" variant="link" @click="login">{{ t('quoteRequest.loginFirst') }}</Button>
        </form>
        <aside class="space-y-4 lg:sticky lg:top-24"><section class="border-t"><CardHeader class="px-0"><FileText class="size-6 text-muted-foreground" /><CardTitle class="text-lg">{{ manual ? t('quoteRequest.manualSideTitle') : t('quoteRequest.schemeSideTitle') }}</CardTitle></CardHeader><CardContent class="space-y-4 px-0 text-sm">
          <p v-if="!manual" class="break-all font-mono">{{ code }}</p><p v-else>{{ t('quoteRequest.schemeSideNote') }}</p><p v-if="loading" class="text-muted-foreground">{{ t('quoteRequest.schemeLoading') }}</p>
          <template v-else-if="context"><p>{{ t('quoteRequest.schemeMeta', { bomRevision: context.bomRevision, schemeRevision: context.schemeRevision }) }}</p><img v-if="themePreview || standardPreview" :src="themePreview || standardPreview" :alt="theme ? t('quoteRequest.themeEffectSelected') : t('quoteRequest.themeEffectStandard')" class="aspect-video w-full rounded-md object-contain" /><p>{{ theme ? t('quoteRequest.themeEffectWithTheme') : t('quoteRequest.themeEffectWithoutTheme') }}</p><p v-if="theme" class="text-xs text-muted-foreground">{{ t('quoteRequest.artworkPending') }}</p></template>
          <div v-if="matchingSummary" class="space-y-2 border-t pt-4 text-sm"><p class="font-medium">{{ matchingSummary.matchType === 'direct' ? t('quoteRequest.requirementMatched') : t('quoteRequest.requirementReference') }}</p><p v-for="difference in matchingSummary.differences" :key="difference.field">{{ difference.requested }} → {{ difference.actual }}：{{ difference.reason }}</p><p v-for="confirmation in matchingSummary.pendingConfirmations" :key="confirmation.message">{{ confirmation.message }}</p></div>
          <p class="border-t pt-4 text-sm leading-6 text-muted-foreground">{{ t('quoteRequest.schemeDisclaimer') }}</p>
        </CardContent></section></aside>
      </div>
    </template>
  </main></MainLayout>
</template>
