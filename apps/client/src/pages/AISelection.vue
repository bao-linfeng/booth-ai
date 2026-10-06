<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { appLocale } from '@/plugins/i18n'
import { ArrowRight, Sparkles, ShieldCheck, Pencil, MessageCircle, Search, LoaderCircle, CircleAlert, ArrowUpRight, Check, Coins, RotateCcw } from 'lucide-vue-next'
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
import { emptyRequirement, type SelectionState, type Catalog, type MatchItem, type MatchResponse, type ParseResponse, type Requirement } from '@/features/selection/types'
import { previewCatalog, previewItems, previewStates } from '@/features/selection/preview'
import { apiFetch } from '@/lib/api-client'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
import { useCredits } from '@/composables/useCredits'

const { loading: creditsLoading, signedInToday, fetchBalance, signIn } = useCredits()

const isSigningIn = ref(false)
const showRewardAnimation = ref(false)
const rewardAmount = ref(0)

async function handleSignIn() {
  if (signedInToday.value || isSigningIn.value) return
  isSigningIn.value = true
  const result = await signIn()
  isSigningIn.value = false
  if (result.success && result.amount) {
    rewardAmount.value = result.amount
    showRewardAnimation.value = true
    setTimeout(() => { showRewardAnimation.value = false }, 2000)
  }
}

const isPreview = computed(() => route.path.startsWith('/ai-selection/preview'))
const requirement = ref(emptyRequirement())
const text = ref('')
const state = ref<SelectionState>('idle')
const previewMode = ref('idle')
const editing = ref(false)
const confirmedClarifications = ref<Record<number, string>>({})
const outcomeVisible = computed(() => state.value === 'results' || state.value === 'empty')
const manualOpen = ref(false)
const manualName = ref('')
const manualContact = ref('')
const manualDescription = ref('')
const snapshot = ref('')
const stale = computed(() => !!snapshot.value && snapshot.value !== JSON.stringify({ requirement: requirement.value, text: text.value }))
const busy = computed(() => state.value === 'parsing' || state.value === 'matching')
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
const canSearch = computed(() => !busy.value && !requirementError.value && (isPreview.value || catalogState.value === 'ready'))

async function editRequirement() {
  editing.value = true
  await nextTick()
  document.getElementById('requirement-text')?.focus()
}

function clarificationFields(field: string): (keyof Requirement)[] {
  if (field === 'lengthMm' || field === 'widthMm' || field === 'areaM2') return ['lengthMm', 'widthMm', ...(field === 'areaM2' ? ['areaM2' as const] : [])]
  const supportedFields: (keyof Requirement)[] = ['boothSpaceId', 'maxHeightMm', 'openingCount', 'productSystemId', 'styleIds', 'industryIds', 'zoneIds', 'featureIds', 'budgetTierId']
  return supportedFields.includes(field as keyof Requirement) ? [field as keyof Requirement] : []
}

function clarificationValue(field: string) {
  return JSON.stringify(clarificationFields(field).map(key => requirement.value[key]))
}

function confirmClarification(index: number) {
  const item = liveClarifications.value[index]
  if (!item || !clarificationFields(item.field).length || requirementError.value) return
  if (isDimensionClarification(item.field) && (!requirement.value.lengthMm || !requirement.value.widthMm)) return
  confirmedClarifications.value[index] = clarificationValue(item.field)
}

const liveCatalog = ref<Catalog | null>(null)
const liveItems = ref<MatchItem[]>([])
const liveMatchData = ref<MatchResponse | null>(null)
const inspirationResults = computed(() => state.value === 'results' && (isPreview.value ? previewMode.value === 'random' : liveMatchData.value?.mode === 'random'))
const editorVisible = computed(() => editing.value || state.value === 'idle' || state.value === 'error' || inspirationResults.value || (outcomeVisible.value && stale.value))
const liveClarifications = ref<ParseResponse['clarifications']>([])
const parseResult = ref<ParseResponse | null>(null)
const parsedText = ref<string | null>(null)
const parsedRequirement = ref<Requirement | null>(null)
const attemptId = ref<string>(crypto.randomUUID())
const parseId = ref<string>()
const searchId = ref<string>()
const catalogState = ref<'loading' | 'ready' | 'error'>('loading')
const activeImageByCode = ref<Record<string, number>>({})
const imagesExpiresAt = ref(0)
const interruptedRequest = ref(false)
let requestSequence = 0
let catalogSequence = 0
let stopPersistence: (() => void) | undefined
let selectionCleared = false
let imageRefreshTimer: ReturnType<typeof setInterval> | undefined
let imageRefreshPending = false

const selectionSessionKey = 'booth-ai:ai-selection'
const selectionSessionVersion = 3
type PersistedSelection = {
  version: 3
  requirement: Requirement
  text: string
  state: SelectionState
  snapshot: string
  parseResult: ParseResponse | null
  parsedText: string | null
  parsedRequirement: Requirement | null
  liveMatchData: MatchResponse | null
  attemptId: string
  parseId: string | null
  searchId: string | null
  imagesExpiresAt: number
  activeImageByCode: Record<string, number>
  confirmedClarifications?: Record<number, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isRequirement(value: unknown): value is Requirement {
  if (!isRecord(value)) return false
  const nullableNumbers = ['lengthMm', 'widthMm', 'maxHeightMm', 'areaM2', 'openingCount']
  const nullableStrings = ['boothSpaceId', 'productSystemId', 'budgetTierId']
  return nullableNumbers.every(field => isNullableNumber(value[field])) &&
    nullableStrings.every(field => value[field] === null || typeof value[field] === 'string') &&
    ['styleIds', 'industryIds', 'zoneIds', 'featureIds', 'keywords', 'requiredZoneIds', 'requiredFeatureIds', 'excludedZoneIds', 'excludedFeatureIds'].every(field => isStringArray(value[field])) &&
    isRecord(value.applicabilityAnswers) && Object.values(value.applicabilityAnswers).every(answer => typeof answer === 'boolean')
}

function isParseResponse(value: unknown): value is ParseResponse {
  if (!isRecord(value) || !isRequirement(value.requirement)) return false
  const fieldSources = value.fieldSources
  const overrides = value.overrides
  const clarifications = value.clarifications
  const warnings = value.warnings
  return (value.status === 'ready' || value.status === 'needs_clarification') &&
    (value.parser === 'llm' || value.parser === 'rules' || value.parser === 'none') &&
    typeof value.degraded === 'boolean' &&
    isRecord(fieldSources) && Object.values(fieldSources).every(source => isRecord(source) && ['form', 'text', 'derived'].includes(String(source.source)) && (source.evidence === undefined || typeof source.evidence === 'string')) &&
    Array.isArray(overrides) && overrides.every(item => isRecord(item) && typeof item.field === 'string' && typeof item.evidence === 'string') &&
    Array.isArray(clarifications) && clarifications.every(item => isRecord(item) && typeof item.field === 'string' && typeof item.reason === 'string' && typeof item.question === 'string' && isStringArray(item.candidates)) &&
    isStringArray(value.unhandledText) &&
    Array.isArray(warnings) && warnings.every(item => isRecord(item) && typeof item.code === 'string' && typeof item.message === 'string')
}

function isMatchResponse(value: unknown): value is MatchResponse {
  if (!isRecord(value) || !isRequirement(value.requirement) || !Array.isArray(value.items)) return false
  const counts = value.counts
  const diagnostics = value.diagnostics
  const exclusions = isRecord(diagnostics) ? diagnostics.exclusions : null
  return (value.status === 'matched' || value.status === 'no_match' || value.status === 'needs_clarification') &&
    (value.mode === 'filtered' || value.mode === 'random') &&
    value.items.every(item => {
      if (!isRecord(item) || typeof item.code !== 'string' || !['direct', 'reference', 'random'].includes(String(item.matchType))) return false
      if (!Array.isArray(item.images) || !item.images.every(image => isRecord(image) && typeof image.assetId === 'string' && typeof image.url === 'string' && typeof image.thumbnailUrl === 'string' && typeof image.order === 'number' && typeof image.width === 'number' && typeof image.height === 'number')) return false
      const specifications = item.specifications
      return isRecord(specifications) && ['lengthMm', 'widthMm', 'heightMm', 'areaM2', 'openingCount'].every(field => typeof specifications[field] === 'number') &&
        typeof specifications.productSystemId === 'string' && typeof specifications.productSystemLabel === 'string' &&
        isStringArray(item.reasons) && Array.isArray(item.pendingConfirmations) && item.pendingConfirmations.every((p: unknown) => isRecord(p) && typeof (p as Record<string,unknown>).message === 'string' && ((p as Record<string,unknown>).type === 'missing_field' || (p as Record<string,unknown>).type === 'applicability_question')) && isStringArray(item.preferenceMisses) &&
        Array.isArray(item.differences) && item.differences.every(difference => isRecord(difference) &&
          ['field', 'requested', 'actual', 'reason'].every(field => typeof difference[field] === 'string'))
    }) &&
    isRecord(counts) && ['direct', 'reference', 'random', 'total'].every(field => typeof counts[field] === 'number') &&
    isRecord(diagnostics) && typeof diagnostics.reviewedPublished === 'number' && typeof diagnostics.ready === 'number' &&
    isRecord(exclusions) && ['unverifiedChecklist', 'incompleteAssets', 'invalidData', 'productSystem', 'height', 'applicability', 'tags', 'dimensions'].every(field => typeof exclusions[field] === 'number') &&
    isStringArray(value.reasons) && isStringArray(value.suggestions) && isStringArray(value.missingFields)
}

function isSelectionState(value: unknown): value is SelectionState {
  return ['idle', 'parsing', 'matching', 'needs_clarification', 'results', 'empty', 'error'].includes(String(value))
}

function isPersistedSelection(value: unknown): value is PersistedSelection {
  if (!isRecord(value) || value.version !== selectionSessionVersion || !isRequirement(value.requirement) || !isSelectionState(value.state)) return false
  if (typeof value.text !== 'string' || typeof value.snapshot !== 'string' || typeof value.attemptId !== 'string') return false
  if (value.parseResult !== null && !isParseResponse(value.parseResult)) return false
  if (value.parsedText !== null && typeof value.parsedText !== 'string') return false
  if (value.parsedRequirement !== null && !isRequirement(value.parsedRequirement)) return false
  if (value.liveMatchData !== null && !isMatchResponse(value.liveMatchData)) return false
  if (value.state === 'results' && (value.liveMatchData === null || value.liveMatchData.status !== 'matched')) return false
  if (value.state === 'empty' && (value.liveMatchData === null || value.liveMatchData.status !== 'no_match')) return false
  if (value.parseId !== null && typeof value.parseId !== 'string') return false
  if (value.searchId !== null && typeof value.searchId !== 'string') return false
  if (typeof value.imagesExpiresAt !== 'number' || !Number.isFinite(value.imagesExpiresAt)) return false
  if (value.confirmedClarifications !== undefined && (!isRecord(value.confirmedClarifications) || !Object.values(value.confirmedClarifications).every(item => typeof item === 'string'))) return false
  return isRecord(value.activeImageByCode) && Object.values(value.activeImageByCode).every(index => typeof index === 'number' && Number.isInteger(index) && index >= 0)
}

function safeReadSelection(): PersistedSelection | null {
  try {
    const raw = sessionStorage.getItem(selectionSessionKey)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isPersistedSelection(value)) {
      sessionStorage.removeItem(selectionSessionKey)
      return null
    }
    return value
  } catch {
    try { sessionStorage.removeItem(selectionSessionKey) } catch { return null }
    return null
  }
}
watch(appLocale, () => { void loadCatalog() })

function safeWriteSelection(value: PersistedSelection) {
  try { sessionStorage.setItem(selectionSessionKey, JSON.stringify(value)) } catch { return }
}

function safeRemoveSelection() {
  try { sessionStorage.removeItem(selectionSessionKey) } catch { return }
}

function restoredState(value: SelectionState): SelectionState {
  return value === 'parsing' || value === 'matching' ? 'idle' : value
}

function buildSelectionSession(): PersistedSelection {
  return {
    version: selectionSessionVersion,
    requirement: requirement.value,
    text: text.value,
    state: state.value,
    snapshot: snapshot.value,
    parseResult: parseResult.value,
    parsedText: parsedText.value,
    parsedRequirement: parsedRequirement.value,
    liveMatchData: liveMatchData.value,
    attemptId: attemptId.value,
    parseId: parseId.value ?? null,
    searchId: searchId.value ?? null,
    imagesExpiresAt: imagesExpiresAt.value,
    activeImageByCode: activeImageByCode.value,
    confirmedClarifications: confirmedClarifications.value,
  }
}

function restoreSelection(value: PersistedSelection) {
  confirmedClarifications.value = value.confirmedClarifications ?? {}
  interruptedRequest.value = value.state === 'parsing' || value.state === 'matching'
  requirement.value = value.requirement
  text.value = value.text
  state.value = restoredState(value.state)
  snapshot.value = value.snapshot
  parseResult.value = value.parseResult
  parsedText.value = value.parsedText
  parsedRequirement.value = value.parsedRequirement
  liveMatchData.value = value.liveMatchData
  liveItems.value = value.liveMatchData?.items ?? []
  liveClarifications.value = value.parseResult?.clarifications ?? []
  attemptId.value = value.attemptId
  parseId.value = value.parseId ?? undefined
  searchId.value = value.searchId ?? undefined
  imagesExpiresAt.value = value.imagesExpiresAt
  activeImageByCode.value = Object.fromEntries(liveItems.value.map(item => {
    const active = value.activeImageByCode[item.code]
    return [item.code, typeof active === 'number' && active < item.images.length ? active : 0]
  }))
}

function startPersistence() {
  stopPersistence?.()
  if (isPreview.value) return
  stopPersistence = watch(buildSelectionSession, value => {
    selectionCleared = false
    safeWriteSelection(value)
  }, { deep: true, flush: 'post' })
}

function clearSelectionMemory() {
  editing.value = false
  confirmedClarifications.value = {}
  requestSequence++
  attemptId.value = crypto.randomUUID()
  parseId.value = undefined
  searchId.value = undefined
  requirement.value = emptyRequirement()
  text.value = ''
  parsedText.value = null
  parsedRequirement.value = null
  parseResult.value = null
  liveClarifications.value = []
  liveItems.value = []
  liveMatchData.value = null
  imagesExpiresAt.value = 0
  activeImageByCode.value = {}
  interruptedRequest.value = false
  state.value = 'idle'
  snapshot.value = ''
}

function reset() {
  stopPersistence?.()
  clearSelectionMemory()
  if (!isPreview.value) {
    selectionCleared = true
    safeRemoveSelection()
  }
  startPersistence()
}

async function refreshExpiredImages() {
  if (imageRefreshPending || !liveItems.value.length || imagesExpiresAt.value > Date.now() + 30_000) return
  imageRefreshPending = true
  const sequence = requestSequence
  const currentItems = liveItems.value
  let allRefreshed = true
  try {
    const refreshed = await Promise.all(currentItems.map(async item => {
      try {
        const response = await apiFetch<{ code: number; data: { images: MatchItem['images'] } }>(`/api/v1/client/schemes/${encodeURIComponent(item.code)}`)
        if (response.code !== 0 || !Array.isArray(response.data.images) ||
          !item.images.every(image => response.data.images.some(fresh => fresh.assetId === image.assetId))) {
          allRefreshed = false
          return item
        }
        return { ...item, images: item.images.map(image => response.data.images.find(fresh => fresh.assetId === image.assetId)!) }
      } catch {
        allRefreshed = false
        return item
      }
    }))
    if (sequence !== requestSequence || isPreview.value || liveItems.value !== currentItems) return
    liveItems.value = refreshed
    if (liveMatchData.value) liveMatchData.value = { ...liveMatchData.value, items: refreshed }
    if (allRefreshed) imagesExpiresAt.value = Date.now() + 270_000
  } finally {
    imageRefreshPending = false
  }
}

const emptyCatalog: Catalog = { boothSpaces: [], openingCounts: [], productSystems: [], styles: [], industries: [], budgetTiers: [], zones: [], features: [], applicabilityQuestions: [] }
const catalog = computed(() => isPreview.value ? previewCatalog : (liveCatalog.value ?? emptyCatalog))
const textChangedSinceParse = computed(() => parsedText.value !== null && parsedText.value !== text.value)
const unresolvedClarifications = computed(() => liveClarifications.value.filter((item, index) => {
  if (!parsedRequirement.value || item.field === 'text') return true
  if (confirmedClarifications.value[index] === clarificationValue(item.field)) return false
  const field = item.field as keyof Requirement
  if (!(field in requirement.value)) return true
  if (isDimensionClarification(item.field)) {
    return !requirement.value.lengthMm || !requirement.value.widthMm ||
      (requirement.value.lengthMm === parsedRequirement.value.lengthMm && requirement.value.widthMm === parsedRequirement.value.widthMm)
  }
  return JSON.stringify(requirement.value[field]) === JSON.stringify(parsedRequirement.value[field])
}))

function isDimensionClarification(field: string) {
  return field === 'lengthMm' || field === 'widthMm'
}
const canConfirm = computed(() => canSearch.value && !!parsedRequirement.value && !textChangedSinceParse.value && !unresolvedClarifications.value.length)
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
  : liveItems.value
)
const manualQuestions = computed(() => [...new Set([
  ...unresolvedClarifications.value.map(item => item.question),
  ...(parseResult.value?.unhandledText.map(item => t('selection.unrecognizedItem', { item })) ?? []),
  ...(!stale.value && liveMatchData.value?.status === 'no_match' ? liveMatchData.value.reasons : []),
])].slice(0, 30))
const manualOriginalText = computed(() => [text.value.trim(), manualDescription.value.trim()].filter(Boolean).join('\n'))
const contactValid = computed(() => /^(?:1[3-9]\d{9}|\+[1-9]\d{7,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(manualContact.value.trim()))
const canSubmitManual = computed(() => !isPreview.value && !!manualOriginalText.value.trim() && !!manualName.value.trim() && contactValid.value && manualOriginalText.value.length <= 1000)

function cloneRequirement(value: Requirement): Requirement {
  return JSON.parse(JSON.stringify(value)) as Requirement
}

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
  sessionStorage.setItem('booth:manual-context',JSON.stringify({originalDescription:manualOriginalText.value,confirmedRequirements:cloneRequirement(requirement.value),unresolvedQuestions:manualQuestions.value}))
  const contact = manualContact.value.trim()
  const existing = sessionStorage.getItem('booth:manual-draft')
  let draft: { pendingManual?: unknown; receipt?: unknown } | null = null
  try { draft = existing ? JSON.parse(existing) as { pendingManual?: unknown; receipt?: unknown } : null } catch { sessionStorage.removeItem('booth:manual-draft') }
  if (!draft?.pendingManual && !draft?.receipt) sessionStorage.setItem('booth:manual-draft',JSON.stringify({owner:authStore.currentUser?.id ?? null,pending:null,pendingManual:null,
    form:{contactName:manualName.value.trim(),...(contact.includes('@')?{email:contact}:{phone:contact})}}))
  manualOpen.value=false
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

function clearText() {
  text.value = ''
  parsedText.value = null
  parsedRequirement.value = null
  parseResult.value = null
  liveClarifications.value = []
  if (state.value === 'needs_clarification') state.value = 'idle'
}

const fieldLabels: Record<keyof Requirement, string> = {
  boothSpaceId: 'requirementForm.fieldBoothSpaceId',
  lengthMm: 'requirementForm.fieldLengthMm', widthMm: 'requirementForm.fieldWidthMm', maxHeightMm: 'requirementForm.fieldMaxHeightMm', areaM2: 'requirementForm.fieldAreaM2',
  openingCount: 'requirementForm.fieldOpeningCount', productSystemId: 'requirementForm.fieldProductSystemId',
  styleIds: 'requirementForm.fieldStyleIds', industryIds: 'requirementForm.fieldIndustryIds', budgetTierId: 'requirementForm.fieldBudgetTierId',
  zoneIds: 'requirementForm.fieldZoneIds', featureIds: 'requirementForm.fieldFeatureIds', keywords: 'requirementForm.fieldKeywords',
  requiredZoneIds: 'requirementForm.fieldRequiredZoneIds', requiredFeatureIds: 'requirementForm.fieldRequiredFeatureIds',
  excludedZoneIds: 'requirementForm.fieldExcludedZoneIds', excludedFeatureIds: 'requirementForm.fieldExcludedFeatureIds', applicabilityAnswers: 'requirementForm.fieldApplicabilityAnswers'
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
  if (typeof value === 'object') return Object.entries(value).map(([id, answer]) => `${catalog.value.applicabilityQuestions.find(question => question.id === id)?.label ?? id}：${answer ? t('common.yes') : t('common.no')}`).join('、') || t('selection.fieldNotFilled')
  return label(String(value))
}

async function parseText(sequence: number) {
  confirmedClarifications.value = {}
  editing.value = false
  state.value = 'parsing'
  try {
    const res = await apiFetch<{ code: number; data: ParseResponse }>('/api/v1/client/requirements/parse', {
      method: 'POST', body: { attemptId: attemptId.value, text: text.value, form: requirement.value }
    })
    if (sequence !== requestSequence) return false
    if (res.code !== 0) throw new Error('Parse unavailable')
    requirement.value = res.data.requirement
    parsedText.value = text.value
    parsedRequirement.value = cloneRequirement(res.data.requirement)
    parseResult.value = res.data
    attemptId.value = res.data.attemptId ?? attemptId.value
    parseId.value = res.data.parseId
    liveClarifications.value = res.data.clarifications
    if (res.data.status === 'needs_clarification') {
      state.value = 'needs_clarification'
      snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
      return false
    }
    return true
  } catch (error) {
    if (sequence !== requestSequence) return false
    console.error('Parse failed', error)
    state.value = 'error'
    return false
  }
}

async function reparseText() {
  if (!canSearch.value || !text.value.trim()) return
  interruptedRequest.value = false
  const sequence = ++requestSequence
  if (await parseText(sequence)) await doMatch('filtered', true, sequence)
}

function choosePreview(value: string) {
  editing.value = false
  previewMode.value = value
  if (value === 'results' || value === 'needs_clarification') {
    requirement.value = { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, areaM2: 18, maxHeightMm: 4500, openingCount: 2, styleIds: ['modern-minimal'], productSystemId: 'fs62' }
    text.value = t('selection.conditionPlaceholder')
  } else if (value === 'random' || value === 'idle') clearSelectionMemory()
  state.value = value === 'random' ? 'results' : value as SelectionState
  snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
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

async function doMatch(mode: 'random' | 'filtered', textProvided: boolean, sequence: number) {
  editing.value = false
  interruptedRequest.value = false
  state.value = 'matching'
  try {
    const res = await apiFetch<{ code: number; data: MatchResponse }>('/api/v1/client/scheme-matches', {
      method: 'POST',
      body: { attemptId: attemptId.value, ...(parseId.value ? { parseId: parseId.value } : {}), mode, requirement: requirement.value, inputContext: { textProvided, text: text.value, degradedParse: parseResult.value?.degraded ?? false } }
    })
    if (sequence !== requestSequence) return
    if (res.code === 0) {
      liveMatchData.value = res.data
      liveItems.value = res.data.items
      imagesExpiresAt.value = Date.now() + 270_000
      activeImageByCode.value = {}
      attemptId.value = res.data.attemptId ?? attemptId.value
      searchId.value = res.data.searchId
      state.value = res.data.status === 'matched' ? 'results' : res.data.status === 'no_match' ? 'empty' : 'needs_clarification'
      snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
    } else {
      state.value = 'error'
    }
  } catch (error) {
    if (sequence !== requestSequence) return
    console.error('Match failed', error)
    state.value = 'error'
  }
}

function answerApplicability(id: string, value: boolean) {
  if (!canSearch.value || isPreview.value) return
  requirement.value = {
    ...requirement.value,
    applicabilityAnswers: { ...requirement.value.applicabilityAnswers, [id]: value },
  }
  if (state.value === 'results') void submit()
}

async function submit() {
  if (!canSearch.value) return
  if (isPreview.value) {
    editing.value = false
    previewMode.value = conditionRows.value.length || text.value.trim() ? 'results' : 'random'
    state.value = 'results'
    snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
    return
  }
  const sequence = ++requestSequence
  interruptedRequest.value = false
  const textProvided = !!text.value.trim()
  if (textChangedSinceParse.value) {
    if (!await parseText(sequence)) return
  }
  if (textProvided && !parsedRequirement.value) {
    if (!await parseText(sequence)) return
  }
  if (textProvided && unresolvedClarifications.value.length) {
    editing.value = false
    state.value = 'needs_clarification'
    return
  }
  
  const isReqEmpty = Object.values(requirement.value).every(val => val === null || (Array.isArray(val) && val.length === 0) || (typeof val === 'object' && Object.keys(val).length === 0))
  await doMatch(isReqEmpty && !textProvided ? 'random' : 'filtered', textProvided, sequence)
}

function confirm() { 
  if (isPreview.value) {
    editing.value = false
    state.value = 'results'
    snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
  } else {
    if (busy.value || !canConfirm.value) return
    void doMatch('filtered', !!text.value.trim(), ++requestSequence)
  }
}

if (!isPreview.value) {
  const saved = safeReadSelection()
  if (saved) {
    restoreSelection(saved)
    void refreshExpiredImages()
  }
  selectionCleared = !saved
  startPersistence()
}

watch(isPreview, (newVal) => {
  catalogSequence++
  if (newVal && !selectionCleared) safeWriteSelection(buildSelectionSession())
  stopPersistence?.()
  clearSelectionMemory()
  if (!newVal) {
    const saved = safeReadSelection()
    if (saved) {
      restoreSelection(saved)
      void refreshExpiredImages()
    }
    selectionCleared = !saved
    startPersistence()
    void loadCatalog()
  }
})

watch(state, async value => {
  if (value !== 'results' && value !== 'needs_clarification' && value !== 'empty' && value !== 'error') return
  await nextTick()
  const stage = document.getElementById('selection-stage')
  stage?.focus({ preventScroll: true })
  stage?.scrollIntoView({ block: 'start' })
})

function refreshImagesWhenVisible() {
  if (!document.hidden && !isPreview.value) void refreshExpiredImages()
}

onUnmounted(() => {
  document.removeEventListener('visibilitychange', refreshImagesWhenVisible)
  if (imageRefreshTimer) clearInterval(imageRefreshTimer)
  if (!isPreview.value && !selectionCleared) safeWriteSelection(buildSelectionSession())
  requestSequence++
  catalogSequence++
})

onMounted(() => {
  document.addEventListener('visibilitychange', refreshImagesWhenVisible)
  imageRefreshTimer = setInterval(refreshImagesWhenVisible, 60_000)
  if (!isPreview.value) loadCatalog()
  if (authStore.isLoggedIn && !isPreview.value) fetchBalance()
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
        <p class="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck class="size-4 shrink-0 text-success" />{{ t('selection.badge') }}</p>
      </section>
      <Card v-if="!isPreview && catalogState !== 'ready'" :role="catalogState === 'error' ? 'alert' : 'status'"><CardContent class="flex items-center justify-between gap-4 p-5 text-sm"><span>{{ catalogState === 'loading' ? t('selection.catalogLoading') : t('selection.catalogError') }}</span><Button v-if="catalogState === 'error'" variant="outline" @click="loadCatalog">{{ t('selection.catalogReload') }}</Button></CardContent></Card>
      <Card v-if="interruptedRequest && !isPreview" role="status"><CardContent class="p-5 text-sm">{{ t('selection.interruptedNotice') }}</CardContent></Card>
      <Card v-if="isPreview" class="border-dashed"><CardHeader class="pb-3"><CardTitle class="text-sm">{{ t('selection.previewMode') }}</CardTitle><CardDescription>{{ t('selection.previewNotice') }}</CardDescription></CardHeader><CardContent class="flex flex-wrap gap-2"><Button v-for="option in previewStates" :key="option.id" size="sm" :variant="previewMode === option.id ? 'default' : 'outline'" :aria-pressed="previewMode === option.id" @click="choosePreview(option.id)">{{ t(option.labelKey) }}</Button></CardContent></Card>
      <div id="selection-stage" tabindex="-1" class="min-w-0 scroll-mt-24 space-y-6 focus:outline-none">
          <section v-if="!editorVisible" class="space-y-3 border-b pb-6" :aria-label="t('selection.currentRequirementAriaLabel')">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0 flex-1 space-y-2"><h2 class="text-sm font-medium">{{ t('selection.currentRequirement') }}</h2><p v-if="text" class="line-clamp-2 break-words text-sm text-muted-foreground">{{ text }}</p></div>
              <Button variant="outline" size="sm" :disabled="busy" aria-controls="requirement-editor" :aria-expanded="editorVisible" @click="editRequirement"><Pencil class="mr-2 size-3.5" />{{ t('selection.editRequirement') }}</Button>
            </div>
            <div v-if="chips.length" class="flex flex-wrap gap-2"><Badge v-for="chip in chips" :key="chip" variant="outline">{{ chip }}</Badge></div>
            <details v-if="conditionRows.length" class="text-xs"><summary class="cursor-pointer text-muted-foreground focus-visible:outline focus-visible:outline-ring">{{ t('selection.viewAllConditions', { n: conditionRows.length }) }}</summary><dl class="mt-3 grid gap-3 sm:grid-cols-2"><div v-for="row in conditionRows" :key="row.field" class="min-w-0"><dt class="text-muted-foreground">{{ row.label }}</dt><dd class="mt-1 break-words">{{ row.value }}</dd></div></dl></details>
          </section>
          <section v-if="editorVisible" id="requirement-editor" class="space-y-4 border-b pb-5" aria-labelledby="requirement-heading">
            <h2 id="requirement-heading" class="flex items-center gap-2 text-lg font-semibold"><Sparkles class="size-5 text-primary" />{{ t('selection.inputTitle') }}</h2>
            <div class="space-y-3">
              <Label for="requirement-text" class="sr-only">{{ t('selection.inputLabel') }}</Label>
              <Textarea id="requirement-text" :model-value="text" :rows="3" maxlength="1000" :disabled="busy" class="min-h-24 resize-y bg-card p-3 text-base leading-6 focus-visible:ring-1" :placeholder="t('selection.inputPlaceholder')" @update:model-value="text = String($event)" />
              <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-xs text-muted-foreground">{{ t('selection.exampleHint') }}</span>
                  <Button variant="ghost" size="sm" :disabled="busy" @click="text = t('selection.example1Text')">{{ t('selection.example1Label') }}<ArrowUpRight class="ml-1 size-3" /></Button>
                  <Button variant="ghost" size="sm" :disabled="busy" @click="text = t('selection.example2Text')">{{ t('selection.example2Label') }}<ArrowUpRight class="ml-1 size-3" /></Button>
                </div>
                <div class="flex items-center gap-2 text-xs text-muted-foreground"><span>{{ text.length }} / 1000</span><Button v-if="text || parseResult" variant="ghost" size="sm" :disabled="busy" @click="clearText">{{ t('selection.clearInput') }}</Button></div>
              </div>
              <p v-if="textChangedSinceParse" class="text-sm text-warning" role="status">{{ t('selection.textChangedNotice') }}</p>
              <p v-if="requirementError" class="text-sm text-destructive" role="alert">{{ requirementError }}</p>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <Button v-if="!text.trim() && !conditionRows.length" variant="ghost" :disabled="!canSearch" @click="submit">{{ t('selection.inspirationFirst') }}<ArrowUpRight class="ml-1 size-4" /></Button>
                <Button v-else variant="ghost" size="sm" :disabled="busy" @click="reset"><RotateCcw class="mr-1 size-3.5" />{{ t('selection.resetRequirement') }}</Button>
              </div>
              <div class="flex flex-wrap gap-2">
                <Button v-if="editing && !stale && !inspirationResults && state !== 'idle' && state !== 'error'" variant="ghost" @click="editing = false">{{ t('selection.collapseEdit') }}</Button>
                <Button :disabled="!canSearch" class="gap-2" @click="submit"><Search class="size-4" />{{ outcomeVisible && !inspirationResults ? t('selection.rematch') : t('selection.match') }}<ArrowRight class="size-4" /></Button>
              </div>
            </div>
            <div class="border-t pt-4"><RequirementForm v-model="requirement" :catalog="catalog" :disabled="busy || (!isPreview && catalogState !== 'ready')" /></div>
          </section>
          
          <Card v-if="state === 'needs_clarification'" class="border-warning/25 bg-warning/5"><CardHeader><CardTitle class="flex items-center gap-2 text-lg"><CircleAlert class="size-5 text-warning" />{{ t('selection.clarifyTitle') }}</CardTitle><CardDescription>{{ isPreview ? t('selection.clarifySubtitleExample') : t('selection.clarifySubtitleLive') }}</CardDescription></CardHeader><CardContent class="space-y-4">
            <template v-if="isPreview">
              <div class="flex flex-wrap gap-2"><Button variant="outline" @click="requirement = { ...requirement, lengthMm: 6000, widthMm: 3000, areaM2: 18 }">{{ t('selection.dimLength', { value: 6 }) }} × {{ t('selection.dimWidth', { value: 3 }) }}</Button><Button variant="outline" @click="requirement = { ...requirement, lengthMm: 3000, widthMm: 6000, areaM2: 18 }">{{ t('selection.dimLength', { value: 3 }) }} × {{ t('selection.dimWidth', { value: 6 }) }}</Button></div>
            </template>
            <template v-else>
              <div class="space-y-3">
                <div v-for="(clarification, i) in liveClarifications" :key="i" class="space-y-4 rounded-lg border bg-muted/20 p-4 text-sm text-foreground">
                  <p :class="unresolvedClarifications.includes(clarification) ? 'font-medium text-warning' : 'text-muted-foreground'">{{ clarification.question }} <span v-if="!unresolvedClarifications.includes(clarification)">{{ t('selection.confirmed') }}</span></p>
                  <template v-if="clarificationFields(clarification.field).length">
                    <div class="grid gap-4 sm:grid-cols-2"><RequirementField v-for="field in clarificationFields(clarification.field)" :id="`clarification-${i}-${field}`" :key="field" v-model="requirement" :field="field" :catalog="catalog" :disabled="busy" /></div>
                    <Button v-if="unresolvedClarifications.includes(clarification)" variant="outline" size="sm" :disabled="!canSearch || (isDimensionClarification(clarification.field) && (!requirement.lengthMm || !requirement.widthMm))" @click="confirmClarification(i)">{{ t('selection.confirmCurrentValue') }}</Button>
                  </template>
                  <template v-else><p v-if="parseResult?.unhandledText.length" class="break-words text-muted-foreground">{{ t('selection.unrecognized') }}{{ parseResult.unhandledText.join('、') }}</p><Label :for="`clarification-text-${i}`">{{ t('selection.editRequirementText') }}</Label><Textarea :id="`clarification-text-${i}`" v-model="text" maxlength="1000" :disabled="busy" /><Button variant="outline" :disabled="!canSearch || !text.trim()" @click="reparseText">{{ t('selection.reparse') }}</Button></template>
                </div>
                <p v-if="!liveClarifications.length" class="text-sm text-muted-foreground">{{ liveMatchData?.reasons.join('；') || t('selection.clarifyError') }}</p>
                <Button v-if="!liveClarifications.length" variant="outline" @click="editRequirement">{{ t('selection.editRequirement') }}</Button>
              </div>
            </template>
             <p v-if="requirementError" class="text-sm text-destructive" role="alert">{{ requirementError }}</p>
             <p v-if="textChangedSinceParse" class="text-sm text-warning">{{ t('selection.textChangedParsePending') }}</p>
             <p class="text-xs leading-relaxed text-muted-foreground">{{ t('selection.clarifyGuide') }}</p><div class="flex flex-wrap gap-2"><Button :disabled="isPreview ? !canSearch : !canConfirm" @click="confirm">{{ t('selection.confirmAndMatch') }}<ArrowRight class="ml-2 size-4" /></Button><Button v-if="textChangedSinceParse" variant="outline" :disabled="!canSearch || !text.trim()" @click="reparseText">{{ t('selection.reparse') }}</Button><Button variant="outline" @click="manualOpen = true">{{ t('selection.transferManual') }}</Button></div></CardContent></Card>

          <details v-if="!isPreview && parseResult && !busy" class="rounded-lg border px-4 py-3 text-sm">
            <summary class="cursor-pointer text-muted-foreground focus-visible:outline focus-visible:outline-ring">{{ t('selection.sourceTitle') }}</summary>
            <div class="space-y-4 pt-4"><p class="text-xs text-muted-foreground">{{ t('selection.sourceGuideForm') }}</p><p v-if="parseResult.degraded" class="text-xs text-muted-foreground">{{ t('selection.sourceGuideRules') }}</p><dl class="grid gap-3 sm:grid-cols-2"><div v-for="row in sourceRows" :key="row.field" class="min-w-0 border-t pt-3"><dt class="flex items-center justify-between gap-2 font-medium"><span>{{ row.label }}</span><Badge variant="outline">{{ row.source }}</Badge></dt><dd class="mt-1 break-words">{{ row.value }}</dd><p v-if="row.evidence" class="mt-1 break-words text-xs text-muted-foreground">{{ t('selection.sourceBasis') }}{{ row.evidence }}</p></div></dl><div v-if="parseResult.overrides.length" class="space-y-2"><strong class="text-xs">{{ t('selection.sourceOverride') }}</strong><p v-for="override in parseResult.overrides" :key="override.field" class="break-words text-xs">{{ fieldLabel(override.field) }}：{{ displayValue(override.field, override.previousValue) }} → {{ displayValue(override.field, override.value) }} · {{ t('selection.sourceBasis') }}{{ override.evidence }}</p></div><p v-if="parseResult.unhandledText.length" class="break-words text-xs text-warning">{{ t('selection.unrecognized') }}{{ parseResult.unhandledText.join('、') }}</p><Button size="sm" variant="outline" :disabled="!canSearch || !text.trim()" @click="reparseText">{{ t('selection.reparse') }}</Button></div>
          </details>
          <div v-if="outcomeVisible && stale" role="status" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
            <div class="min-w-0 space-y-1"><p class="flex items-center gap-2 text-sm font-medium"><CircleAlert class="size-4 shrink-0 text-warning" />{{ t('selection.staleResultNotice') }}</p><p class="text-xs text-muted-foreground">{{ t('selection.staleResultHint') }}</p><p v-if="requirementError" class="text-sm text-destructive">{{ requirementError }}</p></div>
            <Button :disabled="!canSearch" @click="submit">{{ t('selection.rematchNow') }}<ArrowRight class="ml-2 size-4" /></Button>
          </div>
          
          <Card v-if="busy" aria-live="polite" aria-busy="true"><CardContent class="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center"><LoaderCircle class="size-8 animate-spin text-primary" /><h2 class="text-lg font-medium">{{ state === 'parsing' ? t('selection.loadingParsing') : t('selection.loadingMatching') }}</h2><p class="text-sm text-muted-foreground">{{ isPreview ? t('selection.loadingParsingHint') : t('selection.loadingMatchingHint') }}</p><div class="w-full max-w-xs space-y-3"><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-4/5" /><Skeleton class="h-3 w-3/5" /></div></CardContent></Card>
              <section v-else-if="state === 'results'" class="space-y-4" aria-live="polite"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold">{{ inspirationResults ? t('selection.resultsHeadingInspiration') : t('selection.resultsHeadingMatched') }}</h2><Badge variant="secondary">{{ inspirationResults ? t('selection.resultsTagInspiration') : (isPreview ? t('selection.resultsDirect1') : t('selection.resultsDirectN', { direct: liveMatchData?.counts.direct ?? 0, reference: liveMatchData?.counts.reference ?? 0 })) }}</Badge></div><SchemeCard v-for="(item, index) in items" :key="item.code" :item="item" :index="index" :preview="isPreview" :search-id="searchId" :active="activeImageByCode[item.code] ?? 0" @update:active="activeImageByCode[item.code] = $event" @answer-applicability="answerApplicability" /><p class="text-xs leading-relaxed text-muted-foreground">{{ t('selection.resultsDirectNote') }}</p></section>
          <Card v-else-if="state === 'empty' || state === 'error'" :role="state === 'error' ? 'alert' : 'status'"><CardContent class="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center"><Search v-if="state === 'empty'" class="size-8 text-muted-foreground" /><CircleAlert v-else class="size-8 text-muted-foreground" /><h2 class="text-lg font-medium">{{ state === 'empty' ? t('selection.emptyTitle') : t('selection.emptyTitleError') }}</h2><div v-if="state === 'empty'" class="max-w-md space-y-1 text-sm leading-relaxed text-muted-foreground"><p v-for="reason in liveMatchData?.reasons ?? [t('selection.emptyHint')]" :key="reason">{{ reason }}</p></div><p v-else class="max-w-md text-sm leading-relaxed text-muted-foreground">{{ t('selection.emptyErrorHint') }}</p><div class="flex flex-wrap justify-center gap-2"><Button v-if="state === 'empty'" @click="editRequirement">{{ t('selection.editConditions') }}</Button><Button v-else :disabled="!canSearch" @click="submit">{{ t('common.retry') }}</Button><Button variant="outline" @click="manualOpen = true">{{ t('selection.transferToAdvisor') }}</Button></div></CardContent></Card>
          <div class="flex flex-wrap items-center justify-between gap-4 border-t pt-5"><div class="flex items-center gap-3"><MessageCircle class="size-5 shrink-0 text-muted-foreground" /><p class="text-sm text-muted-foreground">{{ t('selection.advisorCta') }}</p></div><Button variant="ghost" @click="manualOpen = true">{{ t('selection.advisorCtaLink') }}<ArrowUpRight class="ml-2 size-4" /></Button></div>
          <div v-if="authStore.isLoggedIn && !isPreview" class="flex items-center justify-end gap-2 text-xs text-muted-foreground"><span>{{ t('selection.creditsTitle') }}</span><div class="relative"><Button size="sm" variant="ghost" :disabled="creditsLoading || isSigningIn || signedInToday" @click="handleSignIn"><Check v-if="signedInToday" class="mr-1 size-3.5" /><Coins v-else class="mr-1 size-3.5" />{{ signedInToday ? t('selection.checkedIn') : t('selection.checkIn') }}</Button><Transition name="reward-float"><span v-if="showRewardAnimation" class="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-medium text-primary">{{ t('selection.creditsEarned', { amount: rewardAmount }) }}</span></Transition></div></div>
      </div>
    </main>
    <Dialog v-model:open="manualOpen"><DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogTitle>{{ t('selection.manualDialogTitle') }}</DialogTitle><DialogDescription>{{ t('selection.manualDialogDesc') }}</DialogDescription>
      <form class="space-y-4" @submit.prevent="submitManual"><Card><CardContent class="space-y-2 p-4 text-sm"><strong>{{ t('selection.requirementSummaryLabel') }}</strong><p class="break-words">{{ text || t('selection.noTextDesc') }}</p><p class="text-xs text-muted-foreground">{{ chips.join(' · ') || t('selection.noStructureDesc') }}</p><p v-if="manualQuestions.length" class="text-xs text-muted-foreground">{{ t('selection.pendingConfirm') }}{{ manualQuestions.join('；') }}</p></CardContent></Card>
        <div class="space-y-2"><Label for="manual-description">{{ t('selection.manualExtraDesc', { requirement: text.trim() ? t('common.optional') : t('common.required') }) }}</Label><Textarea id="manual-description" v-model="manualDescription" maxlength="1000" :placeholder="t('selection.manualExtraPlaceholder')" /><p v-if="manualOriginalText.length > 1000" class="text-xs text-destructive">{{ t('selection.manualDescLimit') }}</p></div>
        <div class="space-y-2"><Label for="manual-name">{{ t('selection.manualName') }}</Label><Input id="manual-name" v-model="manualName" maxlength="100" :placeholder="t('selection.manualNamePlaceholder')" autocomplete="name" required /></div>
        <div class="space-y-2"><Label for="manual-contact">{{ t('selection.manualContact') }}</Label><Input id="manual-contact" v-model="manualContact" maxlength="254" :placeholder="t('selection.manualContactPlaceholder')" autocomplete="on" required /><p v-if="manualContact && !contactValid" class="text-xs text-destructive">{{ t('selection.manualContactError') }}</p></div>
        <p v-if="isPreview" class="text-xs text-muted-foreground">{{ t('selection.manualPreviewNote') }}</p>
        <Button type="submit" class="w-full" :disabled="!canSubmitManual">{{ t('selection.manualContinue') }}</Button>
      </form></DialogContent></Dialog>
  </MainLayout>
</template>

<style scoped>
.reward-float-enter-active { transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
.reward-float-leave-active { transition: all 0.4s ease-in; }
.reward-float-enter-from { opacity: 0; transform: translate(-50%, 20px) scale(0.5); }
.reward-float-enter-to { opacity: 1; transform: translate(-50%, 0) scale(1); }
.reward-float-leave-from { opacity: 1; transform: translate(-50%, 0) scale(1); }
.reward-float-leave-to { opacity: 0; transform: translate(-50%, -20px) scale(0.8); }
</style>
