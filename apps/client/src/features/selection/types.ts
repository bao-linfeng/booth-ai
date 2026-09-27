export type Side = 'front' | 'right' | 'back' | 'left'
export type SelectionState = 'idle' | 'parsing' | 'matching' | 'needs_clarification' | 'results' | 'empty' | 'error'

export interface Requirement {
  lengthMm: number | null
  widthMm: number | null
  maxHeightMm: number | null
  areaM2: number | null
  openingCount: number | null
  openSides: Side[] | null
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
export interface Catalog {
  dimensions: { lengthMm: number[]; widthMm: number[]; maxHeightMm: number[]; areaM2: number[] }
  productSystems: Option[]
  styles: Option[]
  industries: Option[]
  budgetTiers: Option[]
  zones: Option[]
  features: Option[]
  applicabilityQuestions: { id: string; label: string; helpText: string }[]
}

export interface SchemeImage { assetId: string; url: string; thumbnailUrl: string; order: number; width: number; height: number }
export interface Specifications {
  lengthMm: number; widthMm: number; heightMm: number; areaM2: number
  openingCount: number; openSides: Side[]; productSystemId: string; productSystemLabel: string
}
export interface MatchItem {
  code: string
  matchType: 'direct' | 'reference' | 'random'
  images: SchemeImage[]
  specifications: Specifications
  reasons: string[]
  differences: { field: string; requested: string; actual: string; reason: string }[]
  pendingConfirmations: string[]
  preferenceMisses: string[]
}
export interface MatchResponse {
  status: 'matched' | 'no_match' | 'needs_clarification'
  mode: 'filtered' | 'random'
  requirement: Requirement
  items: MatchItem[]
  counts: { direct: number; reference: number; random: number; total: number }
  reasons: string[]
  suggestions: string[]
  missingFields: string[]
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
}
export interface SchemeDetail {
  code: string
  images: SchemeImage[]
  specifications: Specifications
  applicabilityNotes: string
  resources: Record<string, boolean>
  actions: Record<string, 'available' | 'requiresLogin' | 'requiresAuthorization' | 'unavailable'>
}

export const sides: { id: Side; label: string }[] = [
  { id: 'front', label: '前侧' }, { id: 'right', label: '右侧' },
  { id: 'back', label: '后侧' }, { id: 'left', label: '左侧' },
]
export const emptyRequirement = (): Requirement => ({
  lengthMm: null, widthMm: null, maxHeightMm: null, areaM2: null,
  openingCount: null, openSides: null, productSystemId: null,
  styleIds: [], industryIds: [], budgetTierId: null, zoneIds: [], featureIds: [], keywords: [],
  requiredZoneIds: [], requiredFeatureIds: [], excludedZoneIds: [], excludedFeatureIds: [], applicabilityAnswers: {},
})
