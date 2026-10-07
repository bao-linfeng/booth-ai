import type { MatchItem, MatchResponse, ParseResponse, Requirement, SelectionState } from './types'

// 智选会话（sessionStorage）的唯一读写入口：AISelection 负责保存/恢复，报价页通过 readSelectionQuoteHandoff 取交接数据。
// 结构变更时只需在此处升级版本号，读写双方自动保持一致。
const selectionSessionKey = 'booth-ai:ai-selection'
const selectionSessionVersion = 4

export type PersistedSelection = {
  version: typeof selectionSessionVersion
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

export type SelectionSessionInput = Omit<PersistedSelection, 'version'>

export interface SelectionQuoteHandoff {
  requirementContext: { originalDescription: string; confirmedRequirements: Requirement }
  matchingSummary: Pick<MatchItem, 'matchType' | 'differences' | 'pendingConfirmations'>
}

export function selectionSnapshot(requirement: Requirement, text: string) {
  return JSON.stringify({ requirement, text })
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
    ['styleIds', 'industryIds', 'zoneIds', 'featureIds', 'keywords', 'requiredZoneIds', 'requiredFeatureIds', 'excludedZoneIds', 'excludedFeatureIds'].every(field => isStringArray(value[field]))
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
        isStringArray(item.reasons) && Array.isArray(item.pendingConfirmations) && item.pendingConfirmations.every((p: unknown) => isRecord(p) && typeof p.message === 'string' && p.type === 'missing_field') && isStringArray(item.preferenceMisses) &&
        Array.isArray(item.differences) && item.differences.every(difference => isRecord(difference) &&
          ['field', 'requested', 'actual', 'reason'].every(field => typeof difference[field] === 'string'))
    }) &&
    isRecord(counts) && ['direct', 'reference', 'random', 'total'].every(field => typeof counts[field] === 'number') &&
    isRecord(diagnostics) && typeof diagnostics.reviewedPublished === 'number' && typeof diagnostics.ready === 'number' &&
    isRecord(exclusions) && ['unverifiedChecklist', 'incompleteAssets', 'invalidData', 'productSystem', 'height', 'tags', 'dimensions'].every(field => typeof exclusions[field] === 'number') &&
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

export function readSelectionSession(): PersistedSelection | null {
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

export function writeSelectionSession(value: SelectionSessionInput) {
  const session: PersistedSelection = { ...value, version: selectionSessionVersion }
  try { sessionStorage.setItem(selectionSessionKey, JSON.stringify(session)) } catch { return }
}

export function clearSelectionSession() {
  try { sessionStorage.removeItem(selectionSessionKey) } catch { return }
}

/**
 * 报价交接：仅当当前智选会话是“已出结果且条件未改动”的按条件匹配，且目标方案在本次结果内时才返回。
 * 传入 searchId（来自详情页链路）时还必须与会话中的检索一致，避免历史检索或其他会话的条件被关联到方案。
 */
export function readSelectionQuoteHandoff(schemeCode: string, searchId?: string): SelectionQuoteHandoff | null {
  const session = readSelectionSession()
  const match = session?.liveMatchData
  if (!session || !match || session.state !== 'results' || match.status !== 'matched' || match.mode !== 'filtered') return null
  if (session.snapshot !== selectionSnapshot(session.requirement, session.text)) return null
  if (searchId !== undefined && session.searchId !== searchId) return null
  const item = match.items.find(candidate => candidate.code === schemeCode)
  if (!item) return null
  return {
    requirementContext: { originalDescription: session.text, confirmedRequirements: session.requirement },
    matchingSummary: { matchType: item.matchType, differences: item.differences, pendingConfirmations: item.pendingConfirmations },
  }
}
