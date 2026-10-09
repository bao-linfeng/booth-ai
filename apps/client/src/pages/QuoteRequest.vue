<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, FileText, Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import MainLayout from '@/layouts/MainLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { submitQuote, type QuoteRequest } from '@/services/api/quote-requests'
import { submitManualRequest, type ManualRequest } from '@/services/api/manual-requests'
import { manualDraftKey, readManualHandoff, readSelectionQuoteHandoff } from '@/features/selection/handoff'
import { toRequestPayload } from '@/features/quote-request/form'
import { quoteDraftKey, useRequestDraft } from '@/features/quote-request/useRequestDraft'
import { useQuoteContext } from '@/features/quote-request/useQuoteContext'
import { useRequestValidation } from '@/features/quote-request/useRequestValidation'
import { useRequestSubmission } from '@/features/quote-request/useRequestSubmission'
import RequestFormFields from '@/features/quote-request/RequestFormFields.vue'
import RequestReceipt from '@/features/quote-request/RequestReceipt.vue'

// 报价申请（/schemes/:code/quote）与人工需求（/manual-request）共用此页，按路由名区分
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const auth = useAuthStore()
const code = String(route.params.code)
const manual = route.name === 'ManualRequest'
const draft = useRequestDraft(manual ? manualDraftKey : quoteDraftKey(code, route.query.themeJobId, route.query.artworkJobId), auth.currentUser, manual ? readManualHandoff() : null)
const { form, pending, pendingManual, receipt, originalDescription, confirmedRequirements, unresolvedQuestions, unconfirmedGuestSubmission } = draft
const error = ref('')
const conflict = ref(false)
const { context, theme, themeSearchId, themePreview, standardPreview, artworkJobId, loading, retryable, reload: reloadContext, refresh: refreshContext } = useQuoteContext(code, !manual, { error, conflict })
// 智选需求交接：带主题任务时只认任务自身记录的来源检索（未来自检索或尚未读到任务时不附带需求），
// 避免同一方案在其他检索中的条件被串入；标准报价沿用详情页链路带来的 searchId
const selectionHandoff = computed(() => {
  if (manual) return null
  if (typeof route.query.themeJobId === 'string') return themeSearchId.value ? readSelectionQuoteHandoff(code, themeSearchId.value) : null
  return readSelectionQuoteHandoff(code, typeof route.query.searchId === 'string' ? route.query.searchId : undefined)
})
const matchingSummary = computed(() => selectionHandoff.value?.matchingSummary ?? null)
const { descriptionError, fieldErrors, validate } = useRequestValidation(form, { description: manual ? originalDescription : undefined, isLoggedIn: () => auth.isLoggedIn })
const currentUserId = () => auth.currentUser?.id ?? null

function buildQuote(requestKey: string): QuoteRequest {
  const current = context.value!
  return { requestKey, schemeCode: code, schemeRevision: current.schemeRevision,
    ...(current.bomRevision ? { bomRevision: current.bomRevision } : {}), ...(current.drawingRevision ? { drawingRevision: current.drawingRevision } : {}),
    ...(!theme.value && current.artworkRevision ? { artworkRevision: current.artworkRevision } : {}), ...(theme.value ? { themeSelection: theme.value } : {}),
    ...(artworkJobId.value ? { artworkJobId: artworkJobId.value } : {}),
    entryPoint: theme.value ? 'theme_result' : route.query.entryPoint === 'bill_of_materials' ? 'bill_of_materials' : 'scheme_detail',
    ...toRequestPayload(form), ...(selectionHandoff.value ? { requirementContext: selectionHandoff.value.requirementContext } : {}) }
}
const { busy, submit } = manual
  ? useRequestSubmission({ draft, pending: pendingManual, error, currentUserId, validate, ready: () => true, send: submitManualRequest,
      messages: { accountChanged: 'quoteRequest.errorAccountChanged2', rejected: 'quoteRequest.errorFormInvalid2', network: 'quoteRequest.errorNetworkRetry' },
      build: (requestKey): ManualRequest => ({ requestKey, originalDescription: originalDescription.value, confirmedRequirements: confirmedRequirements.value,
        unresolvedQuestions: unresolvedQuestions.value, entryPoint: 'matching_results', ...toRequestPayload(form) }) })
  : useRequestSubmission({ draft, pending, error, conflict, currentUserId, validate, ready: () => !!context.value, send: submitQuote, build: buildQuote,
      messages: { accountChanged: 'quoteRequest.errorAccountChanged', rejected: 'quoteRequest.errorFormInvalid', network: 'quoteRequest.errorNetworkSubmit' } })
const frozen = computed(() => busy.value || pending.value !== null || pendingManual.value !== null)
// 匿名提交结果未确认时不引导登录：登录后服务端按账号去重，无法再确认这次匿名提交，重新提交会重复建项目
const unconfirmed = computed(() => pending.value !== null || pendingManual.value !== null)

function login() { draft.persist(); void router.push({ path: '/auth/sign-in', query: { redirect: receipt.value ? '/my-projects' : route.fullPath } }) }
async function newRequest() { receipt.value = null; pending.value = null; pendingManual.value = null; draft.persist(); await refreshContext() }
</script>

<template>
  <MainLayout><main id="main-content" class="studio-page">
    <Button variant="ghost" as-child><RouterLink :to="manual ? '/ai-selection' : `/schemes/${encodeURIComponent(code)}`"><ArrowLeft class="mr-2 size-4" />{{ manual ? t('quoteRequest.backToSelection') : t('quoteRequest.backToScheme') }}</RouterLink></Button>
    <RequestReceipt v-if="receipt" :receipt="receipt" :logged-in="auth.isLoggedIn" :guest-email="form.email.trim()" :artwork-fixed="!!artworkJobId" @login="login" @new-request="newRequest" />
    <template v-else>
      <p v-if="unconfirmedGuestSubmission" role="status" class="rounded-md border border-warning/40 p-4 text-sm">{{ t('quoteRequest.guestSubmissionUnconfirmed') }}<RouterLink to="/my-projects" class="ml-1 font-medium text-primary underline">{{ t('quoteRequest.viewProjects') }}</RouterLink></p>
      <header class="studio-header"><p class="studio-eyebrow">{{ t('quoteRequest.pageTitle') }}{{ manual ? t('quoteRequest.typeManual') : t('quoteRequest.typeQuote') }}</p><h1 class="studio-title">{{ manual ? t('quoteRequest.headingManual') : t('quoteRequest.headingQuote') }}</h1><p class="text-base text-muted-foreground">{{ t('quoteRequest.formDesc') }}</p></header>
      <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <form class="space-y-5" novalidate @submit.prevent="submit">
          <fieldset :disabled="frozen" class="studio-panel min-w-0 divide-y">
            <section v-if="manual"><CardHeader><CardTitle class="text-lg">{{ t('quoteRequest.requirementTitle') }}</CardTitle></CardHeader><CardContent class="space-y-3"><Textarea id="request-description" v-model="originalDescription" required maxlength="5000" class="min-h-32" :aria-label="t('quoteRequest.requirementTitle')" :aria-invalid="!!descriptionError" :aria-describedby="descriptionError ? 'request-description-error' : undefined" :placeholder="t('quoteRequest.requirementPlaceholder')" /><p v-if="descriptionError" id="request-description-error" role="alert" class="text-sm text-destructive">{{ descriptionError }}</p><p v-for="question in unresolvedQuestions" :key="question" class="text-sm text-warning">{{ t('quoteRequest.pendingConfirm') }}{{ question }}</p><p class="text-sm text-muted-foreground">{{ t('quoteRequest.manualNote') }}</p></CardContent></section>
            <RequestFormFields :form="form" :errors="fieldErrors" :frozen="frozen" :logged-in="auth.isLoggedIn" />
          </fieldset>
          <p v-if="error" role="alert" class="rounded-md border border-destructive/30 p-4 text-sm text-destructive">{{ error }}</p>
          <Button v-if="conflict" type="button" variant="outline" @click="refreshContext">{{ t('quoteRequest.refreshAndConfirm') }}</Button>
          <Button v-else-if="retryable && !loading" type="button" variant="outline" @click="reloadContext">{{ t('quoteRequest.retryLoadContext') }}</Button>
          <Button :disabled="busy || loading || (!manual && !pending && (!context || conflict))" type="submit" class="w-full sm:w-auto"><Loader2 v-if="busy" class="mr-2 size-4 animate-spin" />{{ busy ? t('quoteRequest.submitting') : pending || pendingManual ? t('quoteRequest.retrySubmit') : manual ? t('quoteRequest.submitManual') : t('quoteRequest.submitQuote') }}</Button>
          <template v-if="!auth.isLoggedIn"><p v-if="unconfirmed" class="text-sm text-muted-foreground">{{ t('quoteRequest.loginAfterConfirm') }}</p><Button v-else type="button" variant="link" @click="login">{{ t('quoteRequest.loginFirst') }}</Button></template>
        </form>
        <aside class="space-y-4 lg:sticky lg:top-24"><section class="border-t"><CardHeader class="px-0"><FileText class="size-6 text-muted-foreground" /><CardTitle class="text-lg">{{ manual ? t('quoteRequest.manualSideTitle') : t('quoteRequest.schemeSideTitle') }}</CardTitle></CardHeader><CardContent class="space-y-4 px-0 text-sm">
          <p v-if="!manual" class="break-all font-mono">{{ code }}</p><p v-else>{{ t('quoteRequest.schemeSideNote') }}</p><p v-if="loading" class="text-muted-foreground">{{ t('quoteRequest.schemeLoading') }}</p>
          <template v-else-if="context"><p>{{ t('quoteRequest.schemeMeta', { bomRevision: context.bomRevision, schemeRevision: context.schemeRevision }) }}</p><img v-if="themePreview || standardPreview" :src="themePreview || standardPreview" :alt="theme ? t('quoteRequest.themeEffectSelected') : t('quoteRequest.themeEffectStandard')" class="aspect-video w-full rounded-md object-contain" /><p>{{ theme ? t('quoteRequest.themeEffectWithTheme') : t('quoteRequest.themeEffectWithoutTheme') }}</p><p v-if="artworkJobId" class="text-xs text-muted-foreground">{{ t('quoteRequest.artworkAttached') }}</p><p v-else-if="theme" class="text-xs text-muted-foreground">{{ t('quoteRequest.artworkPending') }}</p></template>
          <div v-if="matchingSummary" class="space-y-2 border-t pt-4 text-sm"><p class="font-medium">{{ matchingSummary.matchType === 'direct' ? t('quoteRequest.requirementMatched') : t('quoteRequest.requirementReference') }}</p><p v-for="difference in matchingSummary.differences" :key="difference.field">{{ difference.requested }} → {{ difference.actual }}：{{ difference.reason }}</p><p v-for="confirmation in matchingSummary.pendingConfirmations" :key="confirmation.message">{{ confirmation.message }}</p></div>
          <p class="border-t pt-4 text-sm leading-6 text-muted-foreground">{{ t('quoteRequest.schemeDisclaimer') }}</p>
        </CardContent></section></aside>
      </div>
    </template>
  </main></MainLayout>
</template>
