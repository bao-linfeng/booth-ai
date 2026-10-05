import type { Catalog, MatchItem, SelectionState } from './types'

export const previewCatalog: Catalog = {
  boothSpaces: [
    { id: '6000-3000-3500', label: '6 × 3 × 3.5 m', lengthMm: 6000, widthMm: 3000, heightMm: 3500 },
    { id: '6000-3000-4500', label: '6 × 3 × 4.5 m', lengthMm: 6000, widthMm: 3000, heightMm: 4500 },
    { id: '9000-3000-4500', label: '9 × 3 × 4.5 m', lengthMm: 9000, widthMm: 3000, heightMm: 4500 },
    { id: '9000-6000-5000', label: '9 × 6 × 5 m', lengthMm: 9000, widthMm: 6000, heightMm: 5000 },
  ],
  openingCounts: [{ id: '1', label: '1面开口' }, { id: '2', label: '2面开口' }, { id: '3', label: '3面开口' }, { id: '4', label: '4面开口（岛式）' }],
  productSystems: [{ id: 'fs62', label: 'FS62 布框' }, { id: 'fs80', label: 'FS80 布框' }, { id: 'truss', label: '桁架体系' }],
  styles: [{ id: 'modern-minimal', label: '现代简约' }, { id: 'technology', label: '科技未来' }, { id: 'natural', label: '自然生态' }, { id: 'industrial', label: '工业风' }, { id: 'elegant', label: '精致典雅' }],
  industries: [{ id: 'technology', label: '科技电子' }, { id: 'medical', label: '医疗健康' }, { id: 'home', label: '家居生活' }, { id: 'food', label: '食品饮料' }, { id: 'general', label: '通用' }],
  budgetTiers: [{ id: 'low', label: '低档' }, { id: 'medium', label: '中档' }, { id: 'high', label: '高档' }],
  zones: [{ id: 'reception', label: '接待区' }, { id: 'meeting', label: '洽谈区' }, { id: 'storage', label: '储藏间' }],
  features: [{ id: 'lightbox', label: '灯箱' }, { id: 'screen', label: '显示屏' }],
  applicabilityQuestions: [{ id: 'freestanding', label: '场馆是否允许自立结构？', helpText: '请参照场馆搭建规范确认；暂不清楚可留空。' }],
}

export const previewStates: { id: SelectionState | 'random'; label: string }[] = [
  { id: 'idle', label: '首次进入' }, { id: 'results', label: '匹配结果' }, { id: 'random', label: '随机推荐' },
  { id: 'needs_clarification', label: '待澄清' }, { id: 'parsing', label: '识别中' },
  { id: 'matching', label: '匹配中' }, { id: 'empty', label: '无结果' }, { id: 'error', label: '服务异常' },
]

export const previewItems: MatchItem[] = [0, 1, 2].map(index => ({
  code: ['DEMO_63_001', 'DEMO_63_002', 'DEMO_66_003'][index]!,
  matchType: index === 0 ? 'direct' : 'reference',
  images: [1, 2, 3].map(order => ({ assetId: `demo-${index}-${order}`, url: '', thumbnailUrl: '', order, width: 1600, height: 900 })),
  specifications: { lengthMm: 6000, widthMm: index === 2 ? 6000 : 3000, heightMm: 3500, areaM2: index === 2 ? 36 : 18, openingCount: index === 1 ? 3 : 2, productSystemId: 'fs62', productSystemLabel: 'FS62 布框' },
  reasons: index === 0 ? ['长宽、开口面数与已确认条件一致', '实际高度 3.5 m，未超过场馆限高'] : [],
  differences: index === 1 ? [{ field: 'openingCount', requested: '2 面', actual: '3 面', reason: '开口面数不同，需重新设计并核验' }] : index === 2 ? [{ field: 'widthMm', requested: '3 m', actual: '6 m', reason: '仅演示尺寸差异状态，不代表真实匹配结果' }] : [],
  pendingConfirmations: index === 0 ? [] : [{ type: 'missing_field' as const, message: '需技术人员核对具体场馆适用条件' }],
  preferenceMisses: index === 2 ? ['材料预算档位与所选偏好不同'] : [],
}))
