<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowRight, Sparkles, ShieldCheck, SlidersHorizontal, MessageCircle, Search, LoaderCircle, CircleAlert, ArrowUpRight, Check, Coins } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import SelectionShell from '@/features/selection/SelectionShell.vue'
import RequirementForm from '@/features/selection/RequirementForm.vue'
import SchemeCard from '@/features/selection/SchemeCard.vue'
import BoothIllustration from '@/features/selection/BoothIllustration.vue'
import { emptyRequirement, type SelectionState, type Catalog, type MatchItem, type MatchResponse, type ParseResponse, type Requirement } from '@/features/selection/types'
import { previewCatalog, previewItems, previewStates } from '@/features/selection/preview'
import { apiFetch } from '@/lib/api-client'

const route = useRoute()
const authStore = useAuthStore()
import { useCredits } from '@/composables/useCredits'

const { balance, loading: creditsLoading, signedInToday, fetchBalance, signIn } = useCredits()
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
const mobileConditions = ref(false)
const manualOpen = ref(false)
const manualName = ref('')
const manualContact = ref('')
const manualDescription = ref('')
const manualSchemeCode = ref<string>()
const manualStatus = ref<'idle' | 'submitting' | 'success' | 'error'>('idle')
const manualReference = ref('')
let manualRequestKey = ''
let manualPayloadSnapshot = ''
let suppressManualStatusReset = false
const manualError = ref('')
const snapshot = ref('')
const stale = computed(() => !!snapshot.value && snapshot.value !== JSON.stringify({ requirement: requirement.value, text: text.value }))
const busy = computed(() => state.value === 'parsing' || state.value === 'matching')

const liveCatalog = ref<Catalog | null>(null)
const liveItems = ref<MatchItem[]>([])
const liveMatchData = ref<MatchResponse | null>(null)
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
const selectionSessionVersion = 2
type PersistedSelection = {
  version: 2
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
  const nullableStrings = ['productSystemId', 'budgetTierId']
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
        isStringArray(item.reasons) && isStringArray(item.pendingConfirmations) && isStringArray(item.preferenceMisses) &&
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
  }
}

function restoreSelection(value: PersistedSelection) {
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
  manualSchemeCode.value = undefined
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

const emptyCatalog: Catalog = { dimensions: { lengthMm: [], widthMm: [], maxHeightMm: [], areaM2: [] }, boothSpaces: [], openingCounts: [], productSystems: [], styles: [], industries: [], budgetTiers: [], zones: [], features: [], applicabilityQuestions: [] }
const catalog = computed(() => isPreview.value ? previewCatalog : (liveCatalog.value ?? emptyCatalog))
const textChangedSinceParse = computed(() => parsedText.value !== null && parsedText.value !== text.value)
const unresolvedClarifications = computed(() => liveClarifications.value.filter(item => {
  if (!parsedRequirement.value || item.field === 'text') return true
  const field = item.field as keyof Requirement
  if (!(field in requirement.value)) return true
  if (item.field === 'lengthMm' && item.question.includes('长宽方向')) {
    return !requirement.value.lengthMm || !requirement.value.widthMm ||
      (requirement.value.lengthMm === parsedRequirement.value.lengthMm && requirement.value.widthMm === parsedRequirement.value.widthMm)
  }
  return JSON.stringify(requirement.value[field]) === JSON.stringify(parsedRequirement.value[field])
}))
const canConfirm = computed(() => !!parsedRequirement.value && !textChangedSinceParse.value && !unresolvedClarifications.value.length)
const sourceRows = computed(() => parseResult.value ? Object.entries(parseResult.value.fieldSources)
  .filter(([field, source]) => source.source !== 'form' || displayValue(field, requirement.value[field as keyof Requirement]) !== '未填写' ||
    (parsedRequirement.value && JSON.stringify(requirement.value[field as keyof Requirement]) !== JSON.stringify(parsedRequirement.value[field as keyof Requirement])))
  .map(([field, source]) => ({
    field,
    label: fieldLabel(field),
    source: parsedRequirement.value && JSON.stringify(requirement.value[field as keyof Requirement]) !== JSON.stringify(parsedRequirement.value[field as keyof Requirement]) ? '人工修正' : { form: '表单', text: '文字识别', derived: '自动计算' }[source.source],
    value: displayValue(field, requirement.value[field as keyof Requirement]),
    evidence: source.evidence
  })) : [])
const items = computed(() => isPreview.value 
  ? previewItems.map(item => previewMode.value === 'random' ? { ...item, matchType: 'random' as const, reasons: [], differences: [], pendingConfirmations: ['尺寸、开口面数、限高和适用条件待确认'] } : item)
  : liveItems.value
)
const selectedManualScheme = computed(() => items.value.find(item => item.code === manualSchemeCode.value))
const manualQuestions = computed(() => [...new Set([
  ...unresolvedClarifications.value.map(item => item.question),
  ...(parseResult.value?.unhandledText.map(item => `未识别：${item}`) ?? []),
  ...(!stale.value && liveMatchData.value?.status === 'no_match' ? liveMatchData.value.reasons : []),
])].slice(0, 30))
const manualOriginalText = computed(() => [text.value.trim(), manualDescription.value.trim()].filter(Boolean).join('\n'))
const contactValid = computed(() => /^(?:1[3-9]\d{9}|\+[1-9]\d{7,14}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(manualContact.value.trim()))
const canSubmitManual = computed(() => !isPreview.value && !!manualName.value.trim() && contactValid.value && manualStatus.value !== 'submitting' &&
  manualOriginalText.value.length <= 1000)

function cloneRequirement(value: Requirement): Requirement {
  return JSON.parse(JSON.stringify(value)) as Requirement
}

function clearManualForm() {
  manualName.value = ''
  manualContact.value = ''
  manualDescription.value = ''
  manualSchemeCode.value = undefined
  manualRequestKey = ''
  manualPayloadSnapshot = ''
  manualError.value = ''
}

function initializeManualForm() {
  const user = authStore.currentUser
  manualName.value = user?.nickname || user?.username || ''
  manualContact.value = user?.mobile || user?.email || ''
}

async function submitManual() {
  if (!canSubmitManual.value) return
  const scheme = stale.value ? undefined : selectedManualScheme.value
  const payload = {
    contactName: manualName.value.trim(), contactDetail: manualContact.value.trim(), originalText: manualOriginalText.value,
    requirement: cloneRequirement(requirement.value), unresolvedQuestions: manualQuestions.value,
    ...(scheme ? { schemeContext: { code: scheme.code, differences: scheme.differences, pendingConfirmations: scheme.pendingConfirmations } } : {}),
  }
  const snapshot = JSON.stringify(payload)
  if (snapshot !== manualPayloadSnapshot) {
    manualRequestKey = crypto.randomUUID()
    manualPayloadSnapshot = snapshot
  }
  manualStatus.value = 'submitting'
  manualError.value = ''
  try {
    const response = await apiFetch<{ code: number; data: { id: string } }>('/api/v1/client/manual-requests', {
      method: 'POST', body: { requestKey: manualRequestKey, ...payload },
    })
    if (response.code !== 0) throw new Error('Manual request failed')
    manualReference.value = response.data.id
    suppressManualStatusReset = true
    clearManualForm()
    manualStatus.value = 'success'
  } catch (error) {
    manualStatus.value = 'error'
    const status = (error as { status?: number }).status
    manualError.value = status === 409 ? '本次提交标识已被其他内容使用，请重新提交。' :
      status === 429 ? '提交过于频繁，请稍后重试。' :
      status === 400 ? '需求或联系方式有误，请核对后重试。' :
      status === 401 || status === 403 ? '登录状态已失效，请刷新页面后重试。' : '提交未确认，请重试。'
    if (status === 409) manualPayloadSnapshot = ''
  }
}

watch([requirement, text, manualName, manualContact, manualSchemeCode, manualDescription], () => {
  if (suppressManualStatusReset) {
    suppressManualStatusReset = false
    return
  }
  if (manualStatus.value === 'success') {
    manualStatus.value = 'idle'
    manualRequestKey = ''
    manualPayloadSnapshot = ''
  }
}, { deep: true })

watch(manualOpen, (open) => {
  if (open) {
    manualStatus.value = 'idle'
    manualReference.value = ''
    clearManualForm()
    initializeManualForm()
  } else {
    manualStatus.value = 'idle'
    manualReference.value = ''
    clearManualForm()
  }
})

const chips = computed(() => {
  const r = requirement.value
  const currentCatalog = catalog.value
  const boothSpace = currentCatalog.boothSpaces.find(space => space.lengthMm === r.lengthMm && space.widthMm === r.widthMm && space.heightMm === r.maxHeightMm)
  return [
    boothSpace ? `空间 ${boothSpace.label}` : '',
    boothSpace ? '' : (r.lengthMm ? `长 ${r.lengthMm / 1000} m` : ''),
    boothSpace ? '' : (r.widthMm ? `宽 ${r.widthMm / 1000} m` : ''),
    r.areaM2 ? `${r.areaM2} ㎡` : '', 
    boothSpace ? '' : (r.maxHeightMm ? `限高 ${r.maxHeightMm / 1000} m` : ''),
    r.openingCount ? `${r.openingCount} 面开口` : '', 
    ...currentCatalog.styles.filter(option => r.styleIds.includes(option.id)).map(option => option.label)
  ].filter(Boolean)
})

function clearText() {
  text.value = ''
  parsedText.value = null
  parsedRequirement.value = null
  parseResult.value = null
  liveClarifications.value = []
  if (state.value === 'needs_clarification') state.value = 'idle'
}

const fieldLabels: Record<keyof Requirement, string> = {
  lengthMm: '展位长', widthMm: '展位宽', maxHeightMm: '场馆限高', areaM2: '面积',
  openingCount: '开口面数', productSystemId: '产品体系',
  styleIds: '设计风格', industryIds: '适用行业', budgetTierId: '材料预算',
  zoneIds: '功能分区', featureIds: '特色功能', keywords: '关键词',
  requiredZoneIds: '必须分区', requiredFeatureIds: '必须特色',
  excludedZoneIds: '禁止分区', excludedFeatureIds: '禁止特色', applicabilityAnswers: '适用条件'
}
function fieldLabel(field: string) { return fieldLabels[field as keyof Requirement] ?? field }
function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || (Array.isArray(value) && !value.length)) return '未填写'
  if (typeof value === 'number') return ['lengthMm', 'widthMm', 'maxHeightMm'].includes(field) ? `${value / 1000} m` : field === 'areaM2' ? `${value} ㎡` : String(value)
  const options = [...catalog.value.productSystems, ...catalog.value.styles, ...catalog.value.industries, ...catalog.value.budgetTiers, ...catalog.value.zones, ...catalog.value.features]
  const label = (id: string) => options.find(option => option.id === id)?.label ?? id
  if (Array.isArray(value)) return value.map(id => label(String(id))).join('、')
  if (typeof value === 'object') return Object.entries(value).map(([id, answer]) => `${catalog.value.applicabilityQuestions.find(question => question.id === id)?.label ?? id}：${answer ? '是' : '否'}`).join('、') || '未填写'
  return label(String(value))
}

async function parseText(sequence: number) {
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
  if (busy.value || !text.value.trim() || catalogState.value !== 'ready') return
  interruptedRequest.value = false
  const sequence = ++requestSequence
  if (await parseText(sequence)) await doMatch('filtered', true, sequence)
}

function choosePreview(value: string) {
  previewMode.value = value
  if (value === 'results' || value === 'needs_clarification') {
    requirement.value = { ...emptyRequirement(), lengthMm: 6000, widthMm: 3000, areaM2: 18, maxHeightMm: 4500, openingCount: 2, styleIds: ['modern-minimal'], productSystemId: 'fs62' }
    text.value = '长6米，宽3米，两面开口，现代简约风格，需要洽谈区。'
  } else if (value === 'random' || value === 'idle') clearSelectionMemory()
  state.value = value === 'random' ? 'results' : value as SelectionState
  snapshot.value = JSON.stringify({ requirement: requirement.value, text: text.value })
}

async function loadCatalog() {
  if (isPreview.value) return
  const sequence = ++catalogSequence
  catalogState.value = 'loading'
  try {
    const res = await apiFetch<{ code: number; data: Catalog }>('/api/v1/client/catalog/options')
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

async function submit() {
  if (busy.value || (!isPreview.value && catalogState.value !== 'ready')) return
  if (isPreview.value) {
    choosePreview(text.value.trim() ? 'needs_clarification' : chips.value.length ? 'results' : 'random')
    return
  }
  const sequence = ++requestSequence
  interruptedRequest.value = false
  const textProvided = !!text.value.trim()
  if (textProvided && !parsedRequirement.value) {
    if (!await parseText(sequence)) return
  }
  if (textChangedSinceParse.value || (textProvided && unresolvedClarifications.value.length)) {
    state.value = 'needs_clarification'
    return
  }
  
  const isReqEmpty = Object.values(requirement.value).every(val => val === null || (Array.isArray(val) && val.length === 0) || (typeof val === 'object' && Object.keys(val).length === 0))
  await doMatch(isReqEmpty && !textProvided ? 'random' : 'filtered', textProvided, sequence)
}

function confirm() { 
  if (isPreview.value) {
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
  fetchBalance()
})
</script>

<template>
  <SelectionShell>
    <main class="container mx-auto space-y-6 px-4 py-8 pb-28 md:px-6 lg:px-8 lg:pb-12">
      <section class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-2"><Badge variant="secondary">AI 智选 · 展台方案</Badge><h1 class="text-2xl font-semibold tracking-tight md:text-3xl">好展台，从选对方案开始</h1><p class="text-sm text-muted-foreground">描述参展需求，发现适合您的空间方案。</p></div>
        <div class="flex flex-col items-end gap-2">
          <div class="relative">
            <Button
              size="sm"
              :variant="signedInToday ? 'secondary' : 'outline'"
              :disabled="creditsLoading || signedInToday"
              @click="handleSignIn"
              class="transition-all duration-300"
              :class="[signedInToday ? 'opacity-80' : 'hover:scale-105 active:scale-95']"
            >
              <Check v-if="signedInToday" class="w-4 h-4 mr-1.5" />
              <Sparkles v-else class="w-4 h-4 mr-1.5" />
              {{ signedInToday ? '今日已签到' : '每日签到' }}
              <span v-if="balance !== null" class="ml-1.5 flex items-center gap-0.5 text-xs text-muted-foreground">
                <Coins class="w-3 h-3 text-yellow-500" />{{ balance }}
              </span>
            </Button>
            <Transition name="reward-float">
              <div
                v-if="showRewardAnimation"
                class="absolute -top-8 left-1/2 -translate-x-1/2 font-bold text-yellow-500 whitespace-nowrap text-sm select-none pointer-events-none flex items-center gap-1 z-20"
              >
                +{{ rewardAmount }}<Coins class="w-3 h-3" />
              </div>
            </Transition>
          </div>
          <p class="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck class="size-4 text-primary" />免费匹配 · 无需登录 · 不扣积分</p>
        </div>
      </section>
      <Card v-if="!isPreview && catalogState !== 'ready'" :role="catalogState === 'error' ? 'alert' : 'status'"><CardContent class="flex items-center justify-between gap-4 p-5 text-sm"><span>{{ catalogState === 'loading' ? '正在加载选型条件…' : '选型条件加载失败，请重试。' }}</span><Button v-if="catalogState === 'error'" variant="outline" @click="loadCatalog">重新加载</Button></CardContent></Card>
      <Card v-if="interruptedRequest && !isPreview" role="status"><CardContent class="p-5 text-sm">上次请求因页面离开而中断，输入已恢复。可重新点击“AI 智选”；如需重新识别文字，请点击“重新解析文字”。</CardContent></Card>
      <Card v-if="isPreview" class="border-dashed"><CardHeader class="pb-3"><CardTitle class="text-sm">UI 静态预览</CardTitle><CardDescription>示例编号与空间示意仅用于界面评审，不代表真实匹配。</CardDescription></CardHeader><CardContent class="flex flex-wrap gap-2"><Button v-for="option in previewStates" :key="option.id" size="sm" :variant="previewMode === option.id ? 'default' : 'outline'" :aria-pressed="previewMode === option.id" @click="choosePreview(option.id)">{{ option.label }}</Button></CardContent></Card>
      <Button variant="outline" class="w-full justify-between lg:hidden" :aria-expanded="mobileConditions" aria-controls="selection-conditions" @click="mobileConditions = !mobileConditions"><span class="flex items-center gap-2"><SlidersHorizontal class="size-4" />展位条件与偏好</span><Badge variant="secondary">{{ chips.length ? `${chips.length} 项` : '选填' }}</Badge></Button>
      <div class="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside id="selection-conditions" :class="cn('space-y-4 lg:block', !mobileConditions && 'hidden')"><RequirementForm v-model="requirement" :catalog="catalog" :disabled="busy || (!isPreview && catalogState !== 'ready')" @reset="reset" /><p class="px-2 text-xs leading-relaxed text-muted-foreground">结构条件决定适用性，风格与预算帮助排序。信息不全时也可以先看参考方案。</p></aside>
        <div class="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle class="flex items-center gap-2 text-base"><Sparkles class="size-4 text-primary" />描述您的理想展台</CardTitle>
              <CardDescription>文字输入为可选项，识别后可核对与修正。</CardDescription>
            </CardHeader>
            <CardContent class="space-y-3">
              <Label for="requirement-text" class="sr-only">一句话描述需求</Label>
              <Textarea id="requirement-text" :model-value="text" maxlength="1000" :disabled="busy" class="min-h-28" placeholder="例如：长6米、宽3米，两面开口，限高4.5米，希望有洽谈区……" @update:model-value="text = String($event)" />
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-muted-foreground">试试：</span>
                <Button variant="secondary" size="sm" :disabled="busy" @click="text = '长6米、宽3米，现代简约风格，需要洽谈区'">简约洽谈空间<ArrowUpRight class="ml-1 size-3" /></Button>
                <Button variant="secondary" size="sm" :disabled="busy" @click="text = '医疗健康行业，必须有储藏间'">医疗 · 带储藏间<ArrowUpRight class="ml-1 size-3" /></Button>
              </div>
            </CardContent>
            <CardFooter class="justify-between border-t pt-3">
              <span class="text-xs text-muted-foreground">文字可覆盖表单条件 · {{ text.length }} / 1000</span>
               <Button variant="ghost" size="sm" :disabled="busy || (!text && !parseResult)" @click="clearText">清空</Button>
            </CardFooter>
          </Card>
           <div class="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0"><p class="text-xs text-muted-foreground">不填条件，也能发现随机灵感</p><Button :disabled="busy || (!isPreview && catalogState !== 'ready')" class="gap-2" @click="submit"><LoaderCircle v-if="busy" class="size-4 animate-spin" /><Sparkles v-else class="size-4" />{{ busy ? state === 'parsing' ? '识别需求中' : '查找方案中' : 'AI 智选' }}<ArrowRight v-if="!busy" class="size-4" /></Button></div>
           <Card v-if="chips.length" class="bg-muted/30"><CardHeader class="pb-3"><div class="flex flex-wrap items-center justify-between gap-2"><CardTitle class="text-sm">当前条件 <span class="font-normal text-muted-foreground">/ 表单</span></CardTitle><Badge v-if="stale" variant="outline">条件已修改 · 结果基于上次条件</Badge></div></CardHeader><CardContent class="space-y-3"><div class="flex flex-wrap gap-2"><Badge v-for="chip in chips" :key="chip" variant="outline">{{ chip }}</Badge></div><p class="text-xs text-muted-foreground">风格、行业及预算为排序偏好；限高与产品体系为严格条件。</p></CardContent></Card>
           <Card v-if="!isPreview && parseResult"><CardHeader class="flex-row items-start justify-between gap-3"><div class="space-y-1"><CardTitle class="text-sm">需求识别与修正</CardTitle><CardDescription>核对文字覆盖的条件；手动修改表单后直接匹配，旧文字不会再次覆盖。</CardDescription></div><Button size="sm" variant="outline" :disabled="busy || !text.trim()" @click="reparseText">重新解析文字</Button></CardHeader><CardContent class="space-y-4 text-sm"><p v-if="textChangedSinceParse" class="text-warning" role="status">描述已修改；当前条件仍来自上次解析。需要应用新文字时请点击“重新解析文字”。</p><p v-if="parseResult.degraded" class="text-xs text-muted-foreground">当前使用规则识别；未识别文字须确认后再匹配。</p><dl class="grid gap-2 sm:grid-cols-2"><div v-for="row in sourceRows" :key="row.field" class="rounded-md border p-3"><dt class="flex items-center justify-between gap-2 font-medium"><span>{{ row.label }}</span><Badge variant="outline">{{ row.source }}</Badge></dt><dd class="mt-1 break-words">{{ row.value }}</dd><p v-if="row.evidence" class="mt-1 break-words text-xs text-muted-foreground">依据：{{ row.evidence }}</p></div></dl><div v-if="parseResult.overrides.length" class="space-y-2"><strong class="text-xs">文字覆盖了表单条件</strong><p v-for="override in parseResult.overrides" :key="override.field" class="break-words text-xs">{{ fieldLabel(override.field) }}：{{ displayValue(override.field, override.previousValue) }} → {{ displayValue(override.field, override.value) }} · 依据：{{ override.evidence }}</p></div><div v-if="parseResult.unhandledText.length" class="text-xs text-warning">未识别：{{ parseResult.unhandledText.join('、') }}</div></CardContent></Card>
          
          <Card v-if="state === 'needs_clarification'"><CardHeader><CardTitle class="flex items-center gap-2 text-base"><CircleAlert class="size-5" />请先确认，我们是否理解正确？</CardTitle><CardDescription>{{ isPreview ? '澄清状态示例：“6×3”尚不能确定左右跨度和前后进深。' : '解析过程中遇到模糊要求，需您确认。' }}</CardDescription></CardHeader><CardContent class="space-y-4">
            <template v-if="isPreview">
              <div class="flex flex-wrap gap-2"><Button variant="outline" @click="requirement = { ...requirement, lengthMm: 6000, widthMm: 3000, areaM2: 18 }">长 6 m × 宽 3 m</Button><Button variant="outline" @click="requirement = { ...requirement, lengthMm: 3000, widthMm: 6000, areaM2: 18 }">长 3 m × 宽 6 m</Button></div>
            </template>
            <template v-else>
              <div class="space-y-3">
                <div v-for="(clarification, i) in liveClarifications" :key="i" class="text-sm text-foreground">
                  <p :class="unresolvedClarifications.includes(clarification) ? 'font-medium text-warning' : 'text-muted-foreground'">{{ clarification.question }} <span v-if="!unresolvedClarifications.includes(clarification)">· 已修正</span></p>
                </div>
              </div>
            </template>
             <p class="text-xs text-muted-foreground">{{ !isPreview && liveClarifications.some(item => item.field === 'text') ? '仍有未识别的文字，请修改描述后重新解析，或转人工确认。' : '请先核对并修正表单条件；只有点击“重新解析文字”才会再次识别。' }}</p><Button :disabled="!isPreview && !canConfirm" @click="confirm">确认已修正条件，继续匹配<ArrowRight class="ml-2 size-4" /></Button><Button v-if="!isPreview && liveClarifications.some(item => item.field === 'text')" variant="outline" @click="manualOpen = true">转人工确认</Button></CardContent></Card>
          
          <Card v-if="state === 'idle'" class="overflow-hidden"><CardContent class="grid items-center gap-3 p-0 xl:grid-cols-2"><div class="space-y-5 p-6"><Badge variant="outline">从想法到空间</Badge><h2 class="text-2xl font-semibold leading-relaxed">让参展想法，<br />有一个具体的空间</h2><p class="text-sm leading-relaxed text-muted-foreground">填写展位尺寸，或用一句话描述需求。先筛选结构，再匹配偏好。</p><ol class="flex flex-wrap gap-4 text-xs text-muted-foreground"><li>01 描述需求</li><li>02 匹配方案</li><li>03 查看详情</li></ol></div><BoothIllustration class="w-full" /></CardContent><CardFooter class="flex-wrap justify-between gap-2 border-t pt-4 text-xs text-muted-foreground"><span>最多 3 套方案 · 每套 3 个视角</span><span>条件不全时明确标注待确认项</span></CardFooter></Card>
          <Card v-else-if="busy" aria-live="polite" aria-busy="true"><CardContent class="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center"><LoaderCircle class="size-8 animate-spin text-primary" /><h2 class="text-lg font-medium">{{ state === 'parsing' ? '正在识别您的需求' : '正在查找适合的方案' }}</h2><p class="text-sm text-muted-foreground">{{ isPreview ? '加载状态预览，可使用顶部工具栏切换。' : '正在调用接口匹配方案，请稍后。' }}</p><div class="w-full max-w-xs space-y-3"><Skeleton class="h-3 w-full" /><Skeleton class="h-3 w-4/5" /><Skeleton class="h-3 w-3/5" /></div></CardContent></Card>
           <section v-else-if="state === 'results'" class="space-y-4" aria-live="polite"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-xl font-semibold">{{ (isPreview ? previewMode === 'random' : liveMatchData?.mode === 'random') ? '先发现一些灵感' : '为您找到的空间方案' }}</h2><Badge variant="secondary">{{ (isPreview ? previewMode === 'random' : liveMatchData?.mode === 'random') ? '随机推荐 · 适用条件待确认' : (isPreview ? '1 套直接采用 · 2 套参考' : `${liveMatchData?.counts.direct ?? 0} 套直接采用 · ${liveMatchData?.counts.reference ?? 0} 套参考`) }}</Badge></div><SchemeCard v-for="(item, index) in items" :key="item.code" :item="item" :index="index" :preview="isPreview" :active="activeImageByCode[item.code] ?? 0" @update:active="activeImageByCode[item.code] = $event" /><p class="text-xs leading-relaxed text-muted-foreground">“可直接采用”指已提供结构条件与审核方案一致，不替代具体项目的报馆及施工确认。</p></section>
           <Card v-else-if="state === 'empty' || state === 'error'" :role="state === 'error' ? 'alert' : 'status'"><CardContent class="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center"><Search v-if="state === 'empty'" class="size-8 text-muted-foreground" /><CircleAlert v-else class="size-8 text-muted-foreground" /><h2 class="text-lg font-medium">{{ state === 'empty' ? '当前组合暂时没有合适的方案' : isPreview ? '服务暂时不可用' : '请求失败' }}</h2><div v-if="state === 'empty'" class="max-w-md space-y-1 text-sm leading-relaxed text-muted-foreground"><p v-for="reason in liveMatchData?.reasons ?? ['您的需求已保留。可主动修改条件，或交给专业顾问。']" :key="reason">{{ reason }}</p></div><p v-else class="max-w-md text-sm leading-relaxed text-muted-foreground">{{ isPreview ? '输入已保留，系统异常不等于无匹配。当前可通过静态预览查看各界面状态。' : '接口调用失败，请检查网络或重试。' }}</p><div class="flex flex-wrap justify-center gap-2"><Button v-if="state === 'empty'" @click="mobileConditions = true; state = 'idle'">修改条件</Button><Button v-else-if="isPreview || state === 'error'" @click="submit">重试</Button><Button v-if="state === 'error' && !isPreview" as-child><RouterLink to="/ai-selection/preview">查看 UI 静态预览</RouterLink></Button><Button variant="outline" @click="manualOpen = true">转人工</Button></div></CardContent></Card>
          <Card><CardContent class="flex flex-wrap items-center gap-4 p-5"><MessageCircle class="size-6 text-primary" /><div class="flex-1 space-y-1"><h3 class="text-sm font-medium">特别的想法，交给专业的人</h3><p class="text-xs text-muted-foreground">尺寸特殊、需求复杂？让顾问一起梳理。</p></div><Button variant="outline" @click="manualOpen = true">转人工沟通<ArrowUpRight class="ml-2 size-4" /></Button></CardContent></Card>
        </div>
      </div>
    </main>
    <Dialog v-model:open="manualOpen"><DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogTitle>把需求交给专业顾问</DialogTitle><DialogDescription>留下联系方式，顾问可根据当前条件和待确认问题跟进。无需登录。</DialogDescription>
      <div v-if="manualStatus === 'success'" role="status" class="space-y-4 rounded-lg border bg-muted/30 p-5"><ShieldCheck class="size-7 text-primary" /><p class="font-medium">需求已提交，我们会尽快与您联系。</p><p class="break-all text-xs text-muted-foreground">需求编号：{{ manualReference }}</p><Button class="w-full" @click="manualOpen = false">完成</Button></div>
      <template v-else><form class="space-y-4" @submit.prevent="submitManual"><Card><CardContent class="space-y-2 p-4 text-sm"><strong>需求摘要</strong><p class="break-words">{{ text || '暂无文字描述' }}</p><p class="text-xs text-muted-foreground">{{ chips.join(' · ') || '尚未填写结构条件' }}</p><p v-if="manualQuestions.length" class="text-xs text-muted-foreground">待确认：{{ manualQuestions.join('；') }}</p></CardContent></Card>
        <div v-if="items.length && !stale" class="space-y-2"><Label for="manual-scheme">关联当前方案（选填）</Label><Select v-model="manualSchemeCode"><SelectTrigger id="manual-scheme" aria-label="关联当前方案"><SelectValue placeholder="不关联方案" /></SelectTrigger><SelectContent><SelectItem v-for="item in items" :key="item.code" :value="item.code">{{ item.code }} · {{ item.matchType === 'direct' ? '可直接采用' : '参考方案' }}</SelectItem></SelectContent></Select><p v-if="selectedManualScheme" class="text-xs text-muted-foreground">将一并提交此方案的匹配差异与待确认事项。</p></div>
        <div class="space-y-2"><Label for="manual-description">补充需求（选填）</Label><Textarea id="manual-description" v-model="manualDescription" maxlength="1000" placeholder="还有哪些需求希望顾问了解？" :disabled="manualStatus === 'submitting'" /><p v-if="manualOriginalText.length > 1000" class="text-xs text-destructive">需求描述合计不能超过 1000 字</p></div>
        <div class="space-y-2"><Label for="manual-name">联系人</Label><Input id="manual-name" v-model="manualName" maxlength="100" placeholder="您的称呼" autocomplete="name" required :disabled="manualStatus === 'submitting'" /></div>
        <div class="space-y-2"><Label for="manual-contact">联系方式</Label><Input id="manual-contact" v-model="manualContact" maxlength="254" placeholder="手机号或邮箱" autocomplete="on" required :disabled="manualStatus === 'submitting'" /><p v-if="manualContact && !contactValid" class="text-xs text-destructive">请输入有效的手机号或邮箱地址</p></div>
        <p v-if="manualStatus === 'error'" role="alert" class="text-sm text-destructive">{{ manualError }}</p><p v-if="isPreview" class="text-xs text-muted-foreground">静态预览不提交真实需求。</p>
        <Button type="submit" class="w-full" :disabled="!canSubmitManual"><LoaderCircle v-if="manualStatus === 'submitting'" class="mr-2 size-4 animate-spin" />{{ manualStatus === 'submitting' ? '正在提交…' : manualStatus === 'error' ? '重试提交' : '提交给顾问' }}</Button>
      </form></template></DialogContent></Dialog>
  </SelectionShell>
</template>

<style scoped>
.reward-float-enter-active { transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
.reward-float-leave-active { transition: all 0.4s ease-in; }
.reward-float-enter-from { opacity: 0; transform: translate(-50%, 20px) scale(0.5); }
.reward-float-enter-to { opacity: 1; transform: translate(-50%, 0) scale(1); }
.reward-float-leave-from { opacity: 1; transform: translate(-50%, 0) scale(1); }
.reward-float-leave-to { opacity: 0; transform: translate(-50%, -20px) scale(0.8); }
</style>
