import { computed, onUnmounted, ref } from 'vue'
import { getVisitorId } from '@/lib/visitor-id'
import { matchSchemes, parseRequirement } from '@/services/api/selection'
import { emptyRequirement, type MatchResponse, type ParseResponse, type Requirement, type SelectionState } from './types'
import { selectionSnapshot, type PersistedSelection, type SelectionSessionInput } from './session'
import { useSchemeImages } from './useSchemeImages'

const clarifiableFields: (keyof Requirement)[] = ['boothSpaceId', 'maxHeightMm', 'openingCount', 'productSystemId', 'styleIds', 'industryIds', 'zoneIds', 'featureIds', 'budgetTierId']

/** 澄清项对应可直接修改的需求字段；尺寸类澄清同时给出长宽（面积澄清再加面积），无对应字段时只能改写描述重新解析 */
export function clarificationFields(field: string): (keyof Requirement)[] {
  if (field === 'lengthMm' || field === 'widthMm' || field === 'areaM2') return ['lengthMm', 'widthMm', ...(field === 'areaM2' ? ['areaM2' as const] : [])]
  return clarifiableFields.includes(field as keyof Requirement) ? [field as keyof Requirement] : []
}

export function isDimensionClarification(field: string) {
  return field === 'lengthMm' || field === 'widthMm'
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isRequirementEmpty(requirement: Requirement) {
  return Object.values(requirement).every(value => value === null || (Array.isArray(value) && value.length === 0))
}

// 解析/匹配请求不会跨页面存活：恢复时把进行中的状态退回 idle，并提示用户重新提交
function restoredState(value: SelectionState): SelectionState {
  return value === 'parsing' || value === 'matching' ? 'idle' : value
}

/**
 * 智选的解析与匹配流程：持有需求、解析结果、匹配结果与请求序号（晚到的旧请求结果一律丢弃）。
 * 调用方负责前置校验（目录就绪、表单合法）和预览模式；这里只处理真实接口链路。
 */
export function useSelectionFlow(options: { enabled: () => boolean }) {
  const requirement = ref(emptyRequirement())
  const text = ref('')
  const state = ref<SelectionState>('idle')
  const snapshot = ref('')
  const parseResult = ref<ParseResponse | null>(null)
  const parsedText = ref<string | null>(null)
  const parsedRequirement = ref<Requirement | null>(null)
  const matchData = ref<MatchResponse | null>(null)
  const attemptId = ref<string>(crypto.randomUUID())
  const parseId = ref<string>()
  const searchId = ref<string>()
  // attemptId/parseId/searchId 所属访客：访客 ID 轮换（退出、令牌失效、其他标签页换号）后不能再沿用这些 ID
  const ownerVisitorId = ref(getVisitorId())
  const confirmedClarifications = ref<Record<number, string>>({})
  const interruptedRequest = ref(false)
  const images = useSchemeImages(matchData, options.enabled)
  let requestSequence = 0

  const busy = computed(() => state.value === 'parsing' || state.value === 'matching')
  const stale = computed(() => !!snapshot.value && snapshot.value !== selectionSnapshot(requirement.value, text.value))
  const items = computed(() => matchData.value?.items ?? [])
  const clarifications = computed(() => parseResult.value?.clarifications ?? [])
  const textChangedSinceParse = computed(() => parsedText.value !== null && parsedText.value !== text.value)

  function clarificationValue(field: string) {
    return JSON.stringify(clarificationFields(field).map(key => requirement.value[key]))
  }

  // 澄清项在用户改动了对应字段或显式确认当前值后视为已解决；文本类澄清只能通过重新解析解决
  const unresolvedClarifications = computed(() => clarifications.value.filter((item, index) => {
    const parsed = parsedRequirement.value
    if (!parsed || item.field === 'text') return true
    if (confirmedClarifications.value[index] === clarificationValue(item.field)) return false
    const field = item.field as keyof Requirement
    if (!(field in requirement.value)) return true
    if (isDimensionClarification(item.field)) {
      return !requirement.value.lengthMm || !requirement.value.widthMm ||
        (requirement.value.lengthMm === parsed.lengthMm && requirement.value.widthMm === parsed.widthMm)
    }
    return sameValue(requirement.value[field], parsed[field])
  }))
  const readyToConfirm = computed(() => !!parsedRequirement.value && !textChangedSinceParse.value && !unresolvedClarifications.value.length)

  function takeSnapshot() {
    snapshot.value = selectionSnapshot(requirement.value, text.value)
  }

  function confirmClarification(index: number) {
    const item = clarifications.value[index]
    if (!item || !clarificationFields(item.field).length) return
    if (isDimensionClarification(item.field) && (!requirement.value.lengthMm || !requirement.value.widthMm)) return
    confirmedClarifications.value[index] = clarificationValue(item.field)
  }

  // 描述被清空后旧解读作废：后续按表单匹配，检索不再关联旧解析记录
  function dropParse() {
    parsedText.value = null
    parsedRequirement.value = null
    parseResult.value = null
    parseId.value = undefined
    confirmedClarifications.value = {}
  }

  function clearText() {
    text.value = ''
    dropParse()
    if (state.value === 'needs_clarification') state.value = 'idle'
  }

  function ensureOwnAttempt() {
    const visitorId = getVisitorId()
    if (ownerVisitorId.value === visitorId) return
    attemptId.value = crypto.randomUUID()
    parseId.value = undefined
    searchId.value = undefined
    ownerVisitorId.value = visitorId
  }

  function clear() {
    confirmedClarifications.value = {}
    requestSequence++
    attemptId.value = crypto.randomUUID()
    ownerVisitorId.value = getVisitorId()
    parseId.value = undefined
    searchId.value = undefined
    requirement.value = emptyRequirement()
    text.value = ''
    parsedText.value = null
    parsedRequirement.value = null
    parseResult.value = null
    matchData.value = null
    images.clear()
    interruptedRequest.value = false
    state.value = 'idle'
    snapshot.value = ''
  }

  async function parse(sequence: number) {
    confirmedClarifications.value = {}
    ensureOwnAttempt()
    state.value = 'parsing'
    try {
      const data = await parseRequirement({ attemptId: attemptId.value, text: text.value, form: requirement.value })
      if (sequence !== requestSequence) return false
      requirement.value = data.requirement
      parsedText.value = text.value
      parsedRequirement.value = JSON.parse(JSON.stringify(data.requirement)) as Requirement
      parseResult.value = data
      attemptId.value = data.attemptId ?? attemptId.value
      parseId.value = data.parseId
      if (data.status === 'needs_clarification') {
        state.value = 'needs_clarification'
        takeSnapshot()
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

  async function match(mode: 'random' | 'filtered', textProvided: boolean, sequence: number) {
    interruptedRequest.value = false
    ensureOwnAttempt()
    state.value = 'matching'
    try {
      const data = await matchSchemes({
        attemptId: attemptId.value, ...(parseId.value ? { parseId: parseId.value } : {}), mode, requirement: requirement.value,
        inputContext: { textProvided, text: text.value, degradedParse: parseResult.value?.degraded ?? false },
      })
      if (sequence !== requestSequence) return
      matchData.value = data
      images.markFresh()
      attemptId.value = data.attemptId ?? attemptId.value
      searchId.value = data.searchId
      state.value = data.status === 'matched' ? 'results' : data.status === 'no_match' ? 'empty' : 'needs_clarification'
      takeSnapshot()
    } catch (error) {
      if (sequence !== requestSequence) return
      console.error('Match failed', error)
      state.value = 'error'
    }
  }

  /** 提交当前需求：描述有改动或尚未解析时先解析，存在未解决的澄清则停在澄清；什么都没填时走灵感推荐 */
  async function submit() {
    const sequence = ++requestSequence
    interruptedRequest.value = false
    const textProvided = !!text.value.trim()
    // 描述被键盘删空或只剩空白：与“清空”按钮一致，不发送空文本解析，直接按表单匹配
    if (!textProvided && parsedText.value !== null) dropParse()
    if (textChangedSinceParse.value && !await parse(sequence)) return
    if (textProvided && !parsedRequirement.value && !await parse(sequence)) return
    if (textProvided && unresolvedClarifications.value.length) {
      state.value = 'needs_clarification'
      return
    }
    await match(isRequirementEmpty(requirement.value) && !textProvided ? 'random' : 'filtered', textProvided, sequence)
  }

  async function reparse() {
    interruptedRequest.value = false
    const sequence = ++requestSequence
    if (await parse(sequence)) await match('filtered', true, sequence)
  }

  function confirm() {
    return match('filtered', !!text.value.trim(), ++requestSequence)
  }

  function toSession(): SelectionSessionInput {
    return {
      requirement: requirement.value,
      text: text.value,
      state: state.value,
      snapshot: snapshot.value,
      parseResult: parseResult.value,
      parsedText: parsedText.value,
      parsedRequirement: parsedRequirement.value,
      liveMatchData: matchData.value,
      attemptId: attemptId.value,
      visitorId: ownerVisitorId.value,
      parseId: parseId.value ?? null,
      searchId: searchId.value ?? null,
      imagesExpiresAt: images.imagesExpiresAt.value,
      activeImageByCode: images.activeImageByCode.value,
      confirmedClarifications: confirmedClarifications.value,
    }
  }

  function restore(value: PersistedSelection) {
    confirmedClarifications.value = value.confirmedClarifications ?? {}
    interruptedRequest.value = value.state === 'parsing' || value.state === 'matching'
    requirement.value = value.requirement
    text.value = value.text
    state.value = restoredState(value.state)
    snapshot.value = value.snapshot
    parseResult.value = value.parseResult
    parsedText.value = value.parsedText
    parsedRequirement.value = value.parsedRequirement
    matchData.value = value.liveMatchData
    attemptId.value = value.attemptId
    ownerVisitorId.value = value.visitorId
    parseId.value = value.parseId ?? undefined
    searchId.value = value.searchId ?? undefined
    images.restore(value.imagesExpiresAt, value.activeImageByCode)
    void images.refreshExpired()
  }

  onUnmounted(() => { requestSequence++ })

  return {
    requirement, text, state, snapshot, parseResult, parsedText, parsedRequirement, matchData, searchId, interruptedRequest,
    activeImageByCode: images.activeImageByCode,
    busy, stale, items, clarifications, textChangedSinceParse, unresolvedClarifications, readyToConfirm,
    takeSnapshot, confirmClarification, clearText, clear, submit, reparse, confirm, toSession, restore,
  }
}
