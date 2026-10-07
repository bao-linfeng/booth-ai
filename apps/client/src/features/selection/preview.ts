import type { Catalog, MatchItem } from './types'

export const previewCatalog: Catalog = {
  boothSpaces: [
    { id: '6000-3000-3500', label: '6 × 3 × 3.5 m', lengthMm: 6000, widthMm: 3000, heightMm: 3500 },
    { id: '6000-3000-4500', label: '6 × 3 × 4.5 m', lengthMm: 6000, widthMm: 3000, heightMm: 4500 },
    { id: '9000-3000-4500', label: '9 × 3 × 4.5 m', lengthMm: 9000, widthMm: 3000, heightMm: 4500 },
    { id: '9000-6000-5000', label: '9 × 6 × 5 m', lengthMm: 9000, widthMm: 6000, heightMm: 5000 },
  ],
  openingCounts: [{ id: '1', label: '1' }, { id: '2', label: '2' }, { id: '3', label: '3' }, { id: '4', label: '4' }],
  productSystems: [{ id: 'fs62', label: 'FS62' }, { id: 'fs80', label: 'FS80' }, { id: 'truss', label: 'truss' }],
  styles: [{ id: 'modern-minimal', label: 'modern-minimal' }, { id: 'technology', label: 'technology' }, { id: 'natural', label: 'natural' }, { id: 'industrial', label: 'industrial' }, { id: 'elegant', label: 'elegant' }],
  industries: [{ id: 'technology', label: 'technology' }, { id: 'medical', label: 'medical' }, { id: 'home', label: 'home' }, { id: 'food', label: 'food' }, { id: 'general', label: 'general' }],
  budgetTiers: [{ id: 'low', label: 'low' }, { id: 'medium', label: 'medium' }, { id: 'high', label: 'high' }],
  zones: [{ id: 'reception', label: 'reception' }, { id: 'meeting', label: 'meeting' }, { id: 'storage', label: 'storage' }],
  features: [{ id: 'lightbox', label: 'lightbox' }, { id: 'screen', label: 'screen' }],
}

export const previewStates: { id: string; labelKey: string }[] = [
  { id: 'idle', labelKey: 'selection.previewStateIdle' }, { id: 'results', labelKey: 'selection.previewStateResults' }, { id: 'random', labelKey: 'selection.previewStateRandom' },
  { id: 'needs_clarification', labelKey: 'selection.previewStateClarification' }, { id: 'parsing', labelKey: 'selection.previewStateParsing' },
  { id: 'matching', labelKey: 'selection.previewStateMatching' }, { id: 'empty', labelKey: 'selection.previewStateEmpty' }, { id: 'error', labelKey: 'selection.previewStateError' },
]

export const previewItems: MatchItem[] = [0, 1, 2].map(index => ({
  code: ['DEMO_63_001', 'DEMO_63_002', 'DEMO_66_003'][index]!,
  matchType: index === 0 ? 'direct' : 'reference',
  images: [1, 2, 3].map(order => ({ assetId: `demo-${index}-${order}`, url: '', thumbnailUrl: '', order, width: 1600, height: 900 })),
  specifications: { lengthMm: 6000, widthMm: index === 2 ? 6000 : 3000, heightMm: 3500, areaM2: index === 2 ? 36 : 18, openingCount: index === 1 ? 3 : 2, productSystemId: 'fs62', productSystemLabel: 'FS62' },
  reasons: [],
  differences: [],
  pendingConfirmations: [],
  preferenceMisses: [],
}))
