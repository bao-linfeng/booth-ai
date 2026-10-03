export type SelectionState = 'idle' | 'parsing' | 'matching' | 'needs_clarification' | 'results' | 'empty' | 'error'

export interface PendingConfirmation {
  type: 'missing_field' | 'applicability_question'
  field?: string
  id?: string
  label?: string
  helpText?: string
  message: string
}

export interface Requirement {
  lengthMm: number | null
  widthMm: number | null
  maxHeightMm: number | null
  areaM2: number | null
  openingCount: number | null
  productSystemId: string | null
  styleIds: string[]
  industryIds: string[]
  budgetTierId: string | null
  zoneIds: string[]
  featureIds: string[]
  keywords: string[]
  requiredZoneIds: string[]
  requiredFeatureIds: string[]
  excludedZoneIds: string[]
  excludedFeatureIds: string[]
  applicabilityAnswers: Record<string, boolean>
}

export interface Option { id: string; label: string }
export interface BoothSpace { id: string; label: string; lengthMm: number; widthMm: number; heightMm: number }
export interface Catalog {
  dimensions: { lengthMm: number[]; widthMm: number[]; maxHeightMm: number[]; areaM2: number[] }
  boothSpaces: BoothSpace[]
  openingCounts: Option[]
  productSystems: Option[]
  styles: Option[]
  industries: Option[]
  budgetTiers: Option[]
  zones: Option[]
  features: Option[]
  applicabilityQuestions: { id: string; label: string; helpText: string }[]
  rulesVersion?: string
  dictionaryVersion?: string
}

export interface SchemeImage { assetId: string; url: string; thumbnailUrl: string; order: number; width: number; height: number }
export type MatchType = 'direct' | 'reference' | 'random'
export interface Specifications {
  lengthMm: number; widthMm: number; heightMm: number; areaM2: number
  openingCount: number; productSystemId: string; productSystemLabel: string
}
export interface MatchItem {
  code: string
  matchType: MatchType
  images: SchemeImage[]
  specifications: Specifications
  reasons: string[]
  differences: { field: string; requested: string; actual: string; reason: string }[]
  pendingConfirmations: PendingConfirmation[]
  preferenceMisses: string[]
}
export interface MatchResponse {
  status: 'matched' | 'no_match' | 'needs_clarification'
  mode: 'filtered' | 'random'
  requirement: Requirement
  items: MatchItem[]
  counts: { direct: number; reference: number; random: number; total: number }
  diagnostics: {
    reviewedPublished: number; ready: number
    exclusions: { unverifiedChecklist: number; incompleteAssets: number; invalidData: number; productSystem: number; height: number; applicability: number; tags: number; dimensions: number }
  }
  reasons: string[]
  suggestions: string[]
  missingFields: string[]
  attemptId?: string
  searchId?: string
  visitorId?: string
}
export interface ParseResponse {
  status: 'ready' | 'needs_clarification'
  requirement: Requirement
  parser: 'llm' | 'rules' | 'none'
  degraded: boolean
  fieldSources: Record<string, { source: 'form' | 'text' | 'derived'; evidence?: string }>
  overrides: { field: string; previousValue: unknown; value: unknown; evidence: string }[]
  clarifications: { field: string; reason: string; question: string; candidates: string[] }[]
  unhandledText: string[]
  warnings: { code: string; message: string }[]
  rulesVersion?: string
  dictionaryVersion?: string
  attemptId?: string
  parseId?: string
  visitorId?: string
}
export interface SchemeDetail {
  code: string
  images: SchemeImage[]
  specifications: Specifications
  applicabilityNotes: string
  resources: Record<string, boolean>
  actions: Record<string, 'available' | 'requiresLogin' | 'requiresAuthorization' | 'unavailable'>
}

export const emptyRequirement = (): Requirement => ({
  lengthMm: null, widthMm: null, maxHeightMm: null, areaM2: null,
  openingCount: null, productSystemId: null,
  styleIds: [], industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
  requiredZoneIds: [], requiredFeatureIds: [], excludedZoneIds: [], excludedFeatureIds: [], applicabilityAnswers: {},
})
