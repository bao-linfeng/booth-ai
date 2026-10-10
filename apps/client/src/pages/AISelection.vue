<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { appLocale } from '@/plugins/i18n'
import { ArrowRight, Sparkles, ShieldCheck, Pencil, MessageCircle, Search, LoaderCircle, CircleAlert, ArrowUpRight, RotateCcw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/layouts/MainLayout.vue'
import RequirementForm from '@/features/selection/RequirementForm.vue'
import RequirementField from '@/features/selection/RequirementField.vue'
import SchemeCard from '@/features/selection/SchemeCard.vue'
import { emptyRequirement, type SelectionState, type Catalog, type Requirement } from '@/features/selection/types'
import { previewCatalog, previewItems, previewStates } from '@/features/selection/preview'
import { clarificationFields, isDimensionClarification, useSelectionFlow } from '@/features/selection/useSelectionFlow'
import { useSelectionSession } from '@/features/selection/useSelectionSession'
import { writeManualHandoff } from '@/features/selection/handoff'
import { apiFetch } from '@/lib/api-client'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const isPreview = computed(() => route.path.startsWith('/ai-selection/preview'))
const flow = useSelectionFlow({ enabled: () => !isPreview.value })
const {
  requirement, text, state, parseResult, parsedRequirement, matchData, searchId, interruptedRequest, activeImageByCode,
  busy, stale, clarifications, textChangedSinceParse, unresolvedClarifications, clearText,
} = flow
const previewMode = ref('idle')
const editing = ref(false)
const outcomeVisible = computed(() => state.value === 'results' || state.value === 'empty')
const manualOpen = ref(false)
const manualName = ref('')
const manualContact = ref('')
const manualDescription = ref('')
const requirementError = computed(() => {
  const r = requirement.value
  if ((['lengthMm', 'widthMm', 'maxHeightMm'] as const).some(field => {
    const value = r[field]
    return value !== null && (!Number.isInteger(value) || value <= 0 || value > 1_000_000)
  })) return t('selection.validationDimensions')
  if (r.areaM2 !== null && (!Number.isFinite(r.areaM2) || r.areaM2 <= 0 || r.areaM2 > 1_000_000)) return t('selection.validationArea')
  if (r.lengthMm && r.widthMm && r.areaM2 !== null && Math.abs(r.areaM2 - r.lengthMm * r.widthMm / 1_000_000) > 0.000001) return t('selection.validationAreaMismatch')
  return ''
})
const catalogState = ref<'loading' | 'ready' | 'error'>('loading')
const canSearch = computed(() => !busy.value && !requirementError.value && (isPreview.value || catalogState.value === 'ready'))
const canConfirm = computed(() => canSearch.value && flow.readyToConfirm.value)
const inspirationResults = computed(() => state.value === 'results' && (isPreview.value ? previewMode.value === 'random' : matchData.value?.mode === 'random'))
const editorVisible = computed(() => editing.value || state.value === 'idle' || state.value === 'error' || inspirationResults.value || (outcomeVisible.value && stale.value))

function clearSelectionMemory() {
  editing.value = false
  flow.clear()
}

const { reset } = useSelectionSession({
  live: computed(() => !isPreview.value),
  snapshot: flow.toSession,
  restore: flow.restore,
  clear: clearSelectionMemory,
})

async function editRequirement() {
  editing.value = true
  await nextTick()
  document.getElementById('requirement-text')?.focus()
}

function confirmClarification(index: number) {
  if (requirementError.value) return
  flow.confirmClarification(index)
}

const liveCatalog = ref<Catalog | null>(null)
let catalogSequence = 0

watch(appLocale, () => { void loadCatalog() })

const emptyCatalog: Catalog = { boothSpaces: [], openingCounts: [], productSystems: [], styles: [], industries: [], budgetTiers: [], zones: [], features: [] }
const catalog = computed(() => isPreview.value ? previewCatalog : (liveCatalog.value ?? emptyCatalog))
const sourceRows = computed(() => parseResult.value ? Object.entries(parseResult.value.fieldSources)
  .filter(([field, source]) => source.source !== 'form' || displayValue(field, requirement.value[field as keyof Requirement]) !== t('selection.fieldNotFilled') ||
    (parsedRequirement.value && JSON.stringify(requirement.value[field as keyof Requirement]) !== JSON.stringify(parsedRequirement.value[field as keyof Requirement])))
  .map(([field, source]) => ({
    field,
    label: fieldLabel(field),
    source: parsedRequirement.value && JSON.stringify(requirement.value[field as keyof Requirement]) !== JSON.stringify(parsedRequirement.value[field as keyof Requirement]) ? t('selection.sourceManual') : { form: t('selection.sourceForm'), text: t('selection.sourceText'), derived: t('selection.sourceDerived') }[source.source],
    value: displayValue(field, requirement.value[field as keyof Requirement]),
    evidence: source.evidence
  })) : [])
const items = computed(() => isPreview.value
  ? previewItems.map(item => previewMode.value === 'random' ? { ...item, matchType: 'random' as const, reasons: [], differences: [], pendingConfirmations: [{ type: 'missing_field' as const, message: t('selection.missingFieldsNotice') }] } : item)
  : flow.items.value
)
const manualQuestions = computed(() => [...new Set([
  ...unresolvedClarifications.value.map(item => item.question),
  ...(parseResult.value?.unhandledText.map(item => t('selection.unrecognizedItem', { item })) ?? []),
  ...(!stale.value && matchData.value?.status === 'no_match' ? matchData.value.reasons : []),
])].slice(0, 30))
const manualOriginalText = computed(() => [text.value.trim(), manualDescription.value.trim()].filter(Boolean).join('\n'))
const contactValid = computed(() => /^(?:1[3-9]\d{9}|\+[1-9]\d{7,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(manualContact.value.trim()))
const canSubmitManual = computed(() => !isPreview.value && !!manualOriginalText.value.trim() && !!manualName.value.trim() && contactValid.value && manualOriginalText.value.length <= 1000)

function clearManualForm() {
  manualName.value = ''
  manualContact.value = ''
  manualDescription.value = ''
}

function initializeManualForm() {
  const user = authStore.currentUser
  manualName.value = user?.nickname || user?.username || ''
  manualContact.value = user?.mobile || user?.email || ''
}

async function submitManual() {
  if (!canSubmitManual.value) return
  writeManualHandoff(
    { originalDescription: manualOriginalText.value, confirmedRequirements: requirement.value, unresolvedQuestions: manualQuestions.value },
    { owner: authStore.currentUser?.id ?? null, name: manualName.value.trim(), contact: manualContact.value.trim() },
  )
  manualOpen.value = false
  await router.push('/manual-request')
}

watch(manualOpen, (open) => {
  if (open) {
    clearManualForm()
    initializeManualForm()
  } else {
    clearManualForm()
  }
})

const chips = computed(() => {
  const r = requirement.value
  const currentCatalog = catalog.value
  return [
    currentCatalog.boothSpaces.find(space => space.id === r.boothSpaceId)?.label ?? '',
    r.lengthMm ? t('selection.dimLength', { value: r.lengthMm / 1000 }) : '',
    r.widthMm ? t('selection.dimWidth', { value: r.widthMm / 1000 }) : '',
    r.areaM2 ? `${r.areaM2} ㎡` : '',
    r.maxHeightMm ? t('selection.dimMaxHeight', { value: r.maxHeightMm / 1000 }) : '',
    r.openingCount ? t('selection.dimOpening', { count: r.openingCount }) : '',
    ...currentCatalog.styles.filter(option => r.styleIds.includes(option.id)).map(option => option.label),
    ...currentCatalog.industries.filter(option => r.industryIds.includes(option.id)).map(option => option.label),
    ...currentCatalog.zones.filter(option => r.zoneIds.includes(option.id) || r.requiredZoneIds.includes(option.id)).map(option => option.label)
  ].filter(Boolean)
})

const conditionRows = computed(() => Object.entries(requirement.value)
  .map(([field, value]) => ({ field, label: fieldLabel(field), value: displayValue(field, value) }))
  .filter(row => row.value !== t('selection.fieldNotFilled')))

const fieldLabels: Record<keyof Requirement, string> = {
  boothSpaceId: 'requirementForm.fieldBoothSpaceId',
  lengthMm: 'requirementForm.fieldLengthMm', widthMm: 'requirementForm.fieldWidthMm', maxHeightMm: 'requirementForm.fieldMaxHeightMm', areaM2: 'requirementForm.fieldAreaM2',
  openingCount: 'requirementForm.fieldOpeningCount', productSystemId: 'requirementForm.fieldProductSystemId',
  styleIds: 'requirementForm.fieldStyleIds', industryIds: 'requirementForm.fieldIndustryIds', budgetTierId: 'requirementForm.fieldBudgetTierId',
  zoneIds: 'requirementForm.fieldZoneIds', featureIds: 'requirementForm.fieldFeatureIds', keywords: 'requirementForm.fieldKeywords',
  requiredZoneIds: 'requirementForm.fieldRequiredZoneIds', requiredFeatureIds: 'requirementForm.fieldRequiredFeatureIds',
  excludedZoneIds: 'requirementForm.fieldExcludedZoneIds', excludedFeatureIds: 'requirementForm.fieldExcludedFeatureIds'
}
function fieldLabel(field: string) {
  const key = fieldLabels[field as keyof Requirement]
  return key ? t(key) : field
}
function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || (Array.isArray(value) && !value.length)) return t('selection.fieldNotFilled')
  if (typeof value === 'number') return ['lengthMm', 'widthMm', 'maxHeightMm'].includes(field) ? `${value / 1000} m` : field === 'areaM2' ? `${value} ㎡` : String(value)
  const options = [...catalog.value.boothSpaces, ...catalog.value.productSystems, ...catalog.value.styles, ...catalog.value.industries, ...catalog.value.budgetTiers, ...catalog.value.zones, ...catalog.value.features]
  const label = (id: string) => options.find(option => option.id === id)?.label ?? id
  if (Array.isArray(value)) return value.map(id => label(String(id))).join('、')
  return label(String(value))
}

async function reparseText() {
  if (!canSearch.value || !text.value.trim()) return
  editing.value = false
  await flow.reparse()
}

function choosePreview(value: string) {
  editing.value = false
  previewMode.value = value
  if (value === 'results' || value === 'needs_clarification') {
    requirement.value = { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, areaM2: 18, maxHeightMm: 4500, openingCount: 2, styleIds: ['modern-minimal'], productSystemId: 'fs62' }
    text.value = t('selection.conditionPlaceholder')
  } else if (value === 'random' || value === 'idle') clearSelectionMemory()
  state.value = value === 'random' ? 'results' : value as SelectionState
  flow.takeSnapshot()
}

async function loadCatalog() {
  if (isPreview.value) return
  const sequence = ++catalogSequence
  catalogState.value = 'loading'
  try {
    const locale = appLocale.value
    const res = await apiFetch<{ code: number; data: Catalog }>(`/api/v1/client/catalog/options?locale=${encodeURIComponent(locale)}`)
    if (sequence !== catalogSequence) return
    if (res.code !== 0) throw new Error('Catalog unavailable')
    liveCatalog.value = { ...res.data, boothSpaces: Array.isArray(res.data.boothSpaces) ? res.data.boothSpaces : [] }
    catalogState.value = 'ready'
  } catch (error) {
    if (sequence !== catalogSequence) return
    console.error('Failed to load catalog', error)
    catalogState.value = 'error'
  }
}

async function submit() {
  if (!canSearch.value) return
  editing.value = false
  if (isPreview.value) {
    previewMode.value = conditionRows.value.length || text.value.trim() ? 'results' : 'random'
    state.value = 'results'
    flow.takeSnapshot()
    return
  }
  await flow.submit()
}

function confirm() {
  if (isPreview.value) {
    editing.value = false
    state.value = 'results'
    flow.takeSnapshot()
  } else {
    if (busy.value || !canConfirm.value) return
    editing.value = false
    void flow.confirm()
  }
}

watch(isPreview, preview => {
  catalogSequence++
  if (!preview) void loadCatalog()
})

watch(state, async value => {
  if (value !== 'results' && value !== 'needs_clarification' && value !== 'empty' && value !== 'error') return
  await nextTick()
  const stage = document.getElementById('selection-stage')
  stage?.focus({ preventScroll: true })
  stage?.scrollIntoView({ block: 'start' })
})

onUnmounted(() => { catalogSequence++ })

onMounted(() => {
  if (!isPreview.value) loadCatalog()
})
</script>

<template>
  <MainLayout>
    <main id="main-content" class="studio-page !space-y-6 !py-6 md:!py-8">
      <section class="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div class="space-y-2">
          <p class="flex items-center gap-3 text-xs font-medium text-muted-foreground"><span class="h-px w-8 bg-primary" />{{ t('selection.pageTitle') }}</p>
          <h1 class="text-[28px] font-semibold leading-snug md:text-[32px]">{{ state === 'needs_clarification' ? t('selection.headingWithClarify') : t('selection.headingDefault') }}</h1>
          <p class="text-sm leading-6 text-muted-foreground">{{ editorVisible ? t('selection.subheadingWithClarify') : t('selection.subheadingDefault') }}</p>
        </div>
        <p class="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck class="size-4 shrink-0 text-success" />{{ t('selection.badge') }}</p>
      </section>
      <Card v-if="!isPreview && catalogState !== 'ready'" :role="catalogState === 'error' ? 'alert' : 'status'"><CardContent class="flex items-center justify-between gap-4 p-5 text-sm"><span>{{ catalogState === 'loading' ? t('selection.catalogLoading') : t('selection.catalogError') }}</span><Button v-if="catalogState === 'error'" variant="outline" @click="loadCatalog">{{ t('selection.catalogReload') }}</Button></CardContent></Card>
      <Card v-if="interruptedRequest && !isPreview" role="status"><CardContent class="p-5 text-sm">{{ t('selection.interruptedNotice') }}</CardContent></Card>
      <Card v-if="isPreview" class="border-dashed"><CardHeader class="pb-3"><CardTitle class="text-sm">{{ t('selection.previewMode') }}</CardTitle><CardDescription>{{ t('selection.previewNotice') }}</CardDescription></CardHeader><CardContent class="flex flex-wrap gap-2"><Button v-for="option in previewStates" :key="option.id" size="sm" :variant="previewMode === option.id ? 'default' : 'outline'" :aria-pressed="previewMode === option.id" @click="choosePreview(option.id)">{{ t(option.labelKey) }}</Button></CardContent></Card>
      <div id="selection-stage" tabindex="-1" class="min-w-0 scroll-mt-24 space-y-6 focus:outline-none">
          <section v-if="!editorVisible" class="space-y-3 border-b pb-6" :aria-label="t('selection.currentRequirementAriaLabel')">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0 flex-1 space-y-2"><h2 class="text-sm font-medium">{{ t('selection.currentRequirement') }}</h2><p v-if="text" dir="auto" class="line-clamp-2 break-words text-sm text-muted-foreground">{{ text }}</p></div>
               <Button variant="outline" size="sm" :disabled="busy" aria-controls="requirement-editor" :aria-expanded="editorVisible" @click="editRequirement"><Pencil class="me-2 size-3.5" />{{ t('selection.editRequirement') }}</Button>
            </div>
            <div v-if="chips.length" class="flex flex-wrap gap-2"><Badge v-for="chip in chips" :key="chip" variant="outline">{{ chip }}</Badge></div>
            <details v-if="conditionRows.length" class="text-xs"><summary class="cursor-pointer text-muted-foreground focus-visible:outline focus-visible:outline-ring">{{ t('selection.viewAllConditions', { n: conditionRows.length }) }}</summary><dl class="mt-3 grid gap-3 sm:grid-cols-2"><div v-for="row in conditionRows" :key="row.field" class="min-w-0"><dt class="text-muted-foreground">{{ row.label }}</dt><dd class="mt-1 break-words">{{ row.value }}</dd></div></dl></details>
          </section>
          <section v-if="editorVisible" id="requirement-editor" class="studio-panel space-y-4 border p-5 md:p-6" aria-labelledby="requirement-heading">
            <h2 id="requirement-heading" class="flex items-center gap-2 text-lg font-semibold"><Sparkles class="size-5 text-primary" />{{ t('selection.inputTitle') }}</h2>
            <div class="space-y-3">
              <Label for="requirement-text" class="sr-only">{{ t('selection.inputLabel') }}</Label>
               <Textarea id="requirement-text" dir="auto" :model-value="text" :rows="3" maxlength="1000" :disabled="busy" class="min-h-24 resize-y bg-background p-3 text-base leading-6 focus-visible:ring-2 focus-visible:ring-primary/40" :placeholder="t('selection.inputPlaceholder')" @update:model-value="text = String($event)" />
              <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-xs text-muted-foreground">{{ t('selection.exampleHint') }}</span>
                   <Button variant="ghost" size="sm" :disabled="busy" @click="text = t('selection.example1Text')">{{ t('selection.example1Label') }}<ArrowUpRight class="ms-1 size-3 rtl:-scale-x-100" /></Button>
                   <Button variant="ghost" size="sm" :disabled="busy" @click="text = t('selection.example2Text')">{{ t('selection.example2Label') }}<ArrowUpRight class="ms-1 size-3 rtl:-scale-x-100" /></Button>
                </div>
                 <div class="flex items-center gap-2 text-xs text-muted-foreground"><bdi dir="ltr">{{ text.length }} / 1000</bdi><Button v-if="text || parseResult" variant="ghost" size="sm" :disabled="busy" @click="clearText">{{ t('selection.clearInput') }}</Button></div>
              </div>
              <p v-if="textChangedSinceParse" class="text-sm text-warning" role="status">{{ t('selection.textChangedNotice') }}</p>
              <p v-if="requirementError" class="text-sm text-destructive" role="alert">{{ requirementError }}</p>
            </div>
            <div class="border-t pt-4"><RequirementForm v-model="requirement" :catalog="catalog" :disabled="busy || (!isPreview && catalogState !== 'ready')" /></div>
            <div class="sticky bottom-0 z-10 -mx-5 !-mb-5 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t bg-card/95 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:-mx-6 md:!-mb-6 md:px-6">
              <div class="flex items-center gap-2">
                 <Button v-if="!text.trim() && !conditionRows.length" variant="ghost" :disabled="!canSearch" @click="submit">{{ t('selection.inspirationFirst') }}<ArrowUpRight class="ms-1 size-4 rtl:-scale-x-100" /></Button>
                 <Button v-else variant="ghost" size="sm" :disabled="busy" @click="reset"><RotateCcw class="me-1 size-3.5" />{{ t('selection.resetRequirement') }}</Button>
              </div>
              <div class="flex flex-wrap gap-2">
                <Button v-if="editing && !stale && !inspirationResults && state !== 'idle' && state !== 'error'" variant="ghost" @click="editing = false">{{ t('selection.collapseEdit') }}</Button>
                 <Button :disabled="!canSearch" class="gap-2" @click="submit"><Search class="size-4" />{{ outcomeVisible && !inspirationResults ? t('selection.rematch') : t('selection.match') }}<ArrowRight class="size-4 rtl:-scale-x-100" /></Button>
              </div>
            </div>
          </section>
          
          <Card v-if="state === 'needs_clarification'" class="border-warning/25 bg-warning/5"><CardHeader><CardTitle class="flex items-center gap-2 text-lg"><CircleAlert class="size-5 text-warning" />{{ t('selection.clarifyTitle') }}</CardTitle><CardDescription>{{ isPreview ? t('selection.clarifySubtitleExample') : t('selection.clarifySubtitleLive') }}</CardDescription></CardHeader><CardContent class="space-y-4">
            <template v-if="isPreview">
              <div class="flex flex-wrap gap-2"><Button variant="outline" @click="requirement = { ...requirement, lengthMm: 6000, widthMm: 3000, areaM2: 18 }">{{ t('selection.dimLength', { value: 6 }) }} × {{ t('selection.dimWidth', { value: 3 }) }}</Button><Button variant="outline" @click="requirement = { ...requirement, lengthMm: 3000, widthMm: 6000, areaM2: 18 }">{{ t('selection.dimLength', { value: 3 }) }} × {{ t('selection.dimWidth', { value: 6 }) }}</Button></div>
            </template>
            <template v-else>
              <div class="space-y-3">
                <div v-for="(clarification, i) in clarifications" :key="i" class="space-y-4 rounded-lg border bg-muted/20 p-4 text-sm text-foreground">
                  <p :class="unresolvedClarifications.includes(clarification) ? 'font-medium text-warning' : 'text-muted-foreground'">{{ clarification.question }} <span v-if="!unresolvedClarifications.includes(clarification)">{{ t('selection.confirmed') }}</span></p>
                  <template v-if="clarificationFields(clarification.field).length">
                    <div class="grid gap-4 sm:grid-cols-2"><RequirementField v-for="field in clarificationFields(clarification.field)" :id="`clarification-${i}-${field}`" :key="field" v-model="requirement" :field="field" :catalog="catalog" :disabled="busy" /></div>
                    <Button v-if="unresolvedClarifications.includes(clarification)" variant="outline" size="sm" :disabled="!canSearch || (isDimensionClarification(clarification.field) && (!requirement.lengthMm || !requirement.widthMm))" @click="confirmClarification(i)">{{ t('selection.confirmCurrentValue') }}</Button>
                  </template>
                  <template v-else><p v-if="parseResult?.unhandledText.length" class="break-words text-muted-foreground">{{ t('selection.unrecognized') }}{{ parseResult.unhandledText.join('、') }}</p><Label :for="`clarification-text-${i}`">{{ t('selection.editRequirementText') }}</Label><Textarea :id="`clarification-text-${i}`" v-model="text" maxlength="1000" :disabled="busy" /><Button variant="outline" :disabled="!canSearch || !text.trim()" @click="reparseText">{{ t('selection.reparse') }}</Button></template>
                </div>
                <p v-if="!clarifications.length" class="text-sm text-muted-foreground">{{ matchData?.reasons.join('；') || t('selection.clarifyError') }}</p>
                <Button v-if="!clarifications.length" variant="outline" @click="editRequirement">{{ t('selection.editRequirement') }}</Button>
              </div>
            </template>
             <p v-if="requirementError" class="text-sm text-destructive" role="alert">{{ requirementError }}</p>
             <p v-if="textChangedSinceParse" class="text-sm text-warning">{{ t('selection.textChangedParsePending') }}</p>
              <p class="text-sm leading-relaxed text-muted-foreground">{{ t('selection.clarifyGuide') }}</p><div class="flex flex-wrap gap-2"><Button :disabled="isPreview ? !canSearch : !canConfirm" @click="confirm">{{ t('selection.confirmAndMatch') }}<ArrowRight class="ms-2 size-4 rtl:-scale-x-100" /></Button><Button v-if="textChangedSinceParse" variant="outline" :disabled="!canSearch || !text.trim()" @click="reparseText">{{ t('selection.reparse') }}</Button><Button variant="outline" @click="manualOpen = true">{{ t('selection.transferManual') }}</Button></div></CardContent></Card>

          <details v-if="!isPreview && parseResult && !busy" class="rounded-lg border px-4 py-3 text-sm">
            <summary class="cursor-pointer text-muted-foreground focus-visible:outline focus-visible:outline-ring">{{ t('selection.sourceTitle') }}</summary>
            <div class="space-y-4 pt-4"><p class="text-xs text-muted-foreground">{{ t('selection.sourceGuideForm') }}</p><p v-if="parseResult.degraded" class="text-xs text-muted-foreground">{{ t('selection.sourceGuideRules') }}</p><dl class="grid gap-3 sm:grid-cols-2"><div v-for="row in sourceRows" :key="row.field" class="min-w-0 border-t pt-3"><dt class="flex items-center justify-between gap-2 font-medium"><span>{{ row.label }}</span><Badge variant="outline">{{ row.source }}</Badge></dt><dd class="mt-1 break-words">{{ row.value }}</dd><p v-if="row.evidence" class="mt-1 break-words text-xs text-muted-foreground">{{ t('selection.sourceBasis') }}{{ row.evidence }}</p></div></dl><div v-if="parseResult.overrides.length" class="space-y-2"><strong class="text-xs">{{ t('selection.sourceOverride') }}</strong><p v-for="override in parseResult.overrides" :key="override.field" class="break-words text-xs">{{ fieldLabel(override.field) }}：{{ displayValue(override.field, override.previousValue) }} → {{ displayValue(override.field, override.value) }} · {{ t('selection.sourceBasis') }}{{ override.evidence }}</p></div><p v-if="parseResult.unhandledText.length" class="break-words text-xs text-warning">{{ t('selection.unrecognized') }}{{ parseResult.unhandledText.join('、') }}</p><Button size="sm" variant="outline" :disabled="!canSearch || !text.trim()" @click="reparseText">{{ t('selection.reparse') }}</Button></div>
          </details>
          <div v-if="outcomeVisible && stale" role="status" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
            <div class="min-w-0 space-y-1"><p class="flex items-center gap-2 text-sm font-medium"><CircleAlert class="size-4 shrink-0 text-warning" />{{ t('selection.staleResultNotice') }}</p><p class="text-sm text-muted-foreground">{{ t('selection.staleResultHint') }}</p><p v-if="requirementError" class="text-sm text-destructive">{{ requirementError }}</p></div>
             <Button :disabled="!canSearch" @click="submit">{{ t('selection.rematchNow') }}<ArrowRight class="ms-2 size-4 rtl:-scale-x-100" /></Button>
          </div>
          
          <Card v-if="busy" aria-live="polite" aria-busy="true"><CardContent class="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center"><LoaderCircle class="size-8 animate-spin text-primary" /><h2 class="text-lg font-medium">{{ state === 'parsing' ? t('selection.loadingParsing') : t('selection.loadingMatching') }}</h2><p class="text-sm text-muted-foreground">{{ isPreview ? t('selection.loadingParsingHint') : t('selection.loadingMatchingHint') }}</p><div class="w-full max-w-xs space-y-3"><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-4/5" /><Skeleton class="h-3 w-3/5" /></div></CardContent></Card>
              <section v-else-if="state === 'results'" class="space-y-4" aria-live="polite"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold">{{ inspirationResults ? t('selection.resultsHeadingInspiration') : t('selection.resultsHeadingMatched') }}</h2><Badge variant="secondary">{{ inspirationResults ? t('selection.resultsTagInspiration') : (isPreview ? t('selection.resultsDirect1') : t('selection.resultsDirectN', { direct: matchData?.counts.direct ?? 0, reference: matchData?.counts.reference ?? 0 })) }}</Badge></div><SchemeCard v-for="(item, index) in items" :key="item.code" :item="item" :index="index" :preview="isPreview" :product-systems="isPreview ? undefined : catalog.productSystems" :search-id="searchId" :active="activeImageByCode[item.code] ?? 0" @update:active="activeImageByCode[item.code] = $event" /><p class="text-sm leading-relaxed text-muted-foreground">{{ t('selection.resultsDirectNote') }}</p></section>
          <Card v-else-if="state === 'empty' || state === 'error'" :role="state === 'error' ? 'alert' : 'status'"><CardContent class="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center"><Search v-if="state === 'empty'" class="size-8 text-muted-foreground" /><CircleAlert v-else class="size-8 text-muted-foreground" /><h2 class="text-lg font-medium">{{ state === 'empty' ? t('selection.emptyTitle') : t('selection.emptyTitleError') }}</h2><div v-if="state === 'empty'" class="max-w-md space-y-1 text-sm leading-relaxed text-muted-foreground"><p v-for="reason in matchData?.reasons ?? [t('selection.emptyHint')]" :key="reason">{{ reason }}</p></div><p v-else class="max-w-md text-sm leading-relaxed text-muted-foreground">{{ t('selection.emptyErrorHint') }}</p><div class="flex flex-wrap justify-center gap-2"><Button v-if="state === 'empty'" @click="editRequirement">{{ t('selection.editConditions') }}</Button><Button v-else :disabled="!canSearch" @click="submit">{{ t('common.retry') }}</Button><Button variant="outline" @click="manualOpen = true">{{ t('selection.transferToAdvisor') }}</Button></div></CardContent></Card>
          <div class="flex flex-wrap items-center justify-between gap-4 border-t pt-5"><div class="flex items-center gap-3"><MessageCircle class="size-5 shrink-0 text-muted-foreground" /><p class="text-sm text-muted-foreground">{{ t('selection.advisorCta') }}</p></div><Button variant="ghost" @click="manualOpen = true">{{ t('selection.advisorCtaLink') }}<ArrowUpRight class="ms-2 size-4 rtl:-scale-x-100" /></Button></div>
      </div>
    </main>
    <Dialog v-model:open="manualOpen"><DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogTitle>{{ t('selection.manualDialogTitle') }}</DialogTitle><DialogDescription>{{ t('selection.manualDialogDesc') }}</DialogDescription>
      <form class="space-y-4" @submit.prevent="submitManual"><Card><CardContent class="space-y-2 p-4 text-sm"><strong>{{ t('selection.requirementSummaryLabel') }}</strong><p class="break-words">{{ text || t('selection.noTextDesc') }}</p><p class="text-xs text-muted-foreground">{{ chips.join(' · ') || t('selection.noStructureDesc') }}</p><p v-if="manualQuestions.length" class="text-xs text-muted-foreground">{{ t('selection.pendingConfirm') }}{{ manualQuestions.join('；') }}</p></CardContent></Card>
        <div class="space-y-2"><Label for="manual-description">{{ t('selection.manualExtraDesc', { requirement: text.trim() ? t('common.optional') : t('common.required') }) }}</Label><Textarea id="manual-description" v-model="manualDescription" maxlength="1000" :placeholder="t('selection.manualExtraPlaceholder')" /><p v-if="manualOriginalText.length > 1000" class="text-xs text-destructive">{{ t('selection.manualDescLimit') }}</p></div>
        <div class="space-y-2"><Label for="manual-name">{{ t('selection.manualName') }}</Label><Input id="manual-name" v-model="manualName" maxlength="100" :placeholder="t('selection.manualNamePlaceholder')" autocomplete="name" required /></div>
        <div class="space-y-2"><Label for="manual-contact">{{ t('selection.manualContact') }}</Label><Input id="manual-contact" v-model="manualContact" :dir="manualContact ? 'ltr' : undefined" maxlength="254" :placeholder="t('selection.manualContactPlaceholder')" autocomplete="on" required /><p v-if="manualContact && !contactValid" class="text-xs text-destructive">{{ t('selection.manualContactError') }}</p></div>
        <p v-if="isPreview" class="text-xs text-muted-foreground">{{ t('selection.manualPreviewNote') }}</p>
        <Button type="submit" class="w-full" :disabled="!canSubmitManual">{{ t('selection.manualContinue') }}</Button>
      </form></DialogContent></Dialog>
  </MainLayout>
</template>
