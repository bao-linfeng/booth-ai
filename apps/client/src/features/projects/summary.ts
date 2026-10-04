import type { Catalog, Option } from '@/features/selection/types'
import type { ProjectStatus } from '@/services/api/projects'

// 下一步只描述当前状态下用户可以做的事，不承诺处理时限或报价金额。
export const nextSteps: Record<ProjectStatus, string> = {
  pending: '申请已收到，等待顾问接手，请保持联系方式畅通。',
  following: '顾问正在跟进，如有补充资料或沟通，会通过您留下的联系方式联系。',
  quoted: '请查看最新进展中的报价说明，确认后与顾问沟通后续安排。',
  won: '项目已成交，正式交付资料由顾问按项目提供。',
  lost: '本次项目未成交，您可以重新选择方案再次申请。',
  closed: '项目已关闭，如需继续可重新选择方案提交申请。',
}

export const closedStatuses: ProjectStatus[] = ['won', 'lost', 'closed']

export function regionName(code?: string | null) {
  if (!code) return ''
  try { return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code.toUpperCase()) ?? code } catch { return code }
}

export function joinParts(parts: Array<string | null | undefined | false>, separator = ' · ') {
  return parts.filter((part): part is string => !!part).join(separator)
}

export function dateRange(start?: string | null, end?: string | null) {
  if (start && end && start !== end) return `${start} 至 ${end}`
  return start || end || ''
}

const meters = (mm: number) => `${Number((mm / 1000).toFixed(3))} m`
const numberOf = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
const idsOf = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []

export interface RequirementSummary {
  specs: string[]
  groups: Array<{ label: string; values: string[] }>
}

// 项目详情里的确认条件来自接口的自由结构；只展示能解析成用户名称的内容，不输出原始 ID 或 JSON。
export function summarizeRequirement(raw: unknown, catalog: Catalog | null): RequirementSummary {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const length = numberOf(source.lengthMm), width = numberOf(source.widthMm)
  const area = numberOf(source.areaM2), height = numberOf(source.maxHeightMm), openings = numberOf(source.openingCount)
  const specs = [
    length && width ? `${meters(length)} × ${meters(width)}` : '',
    area ? `${area} ㎡` : '',
    openings ? `${openings} 面开口` : '',
    height ? `场馆限高 ${meters(height)}` : '',
  ].filter(Boolean)
  const names = (options: Option[] | undefined, ids: string[]) => ids.flatMap(id => options?.find(option => option.id === id)?.label ?? [])
  const groups: RequirementSummary['groups'] = []
  const add = (label: string, values: string[]) => { if (values.length) groups.push({ label, values }) }
  const productSystem = typeof source.productSystemId === 'string' ? [source.productSystemId] : []
  const budgetTier = typeof source.budgetTierId === 'string' ? [source.budgetTierId] : []
  add('产品体系', names(catalog?.productSystems, productSystem))
  add('设计风格', names(catalog?.styles, idsOf(source.styleIds)))
  add('适用行业', names(catalog?.industries, idsOf(source.industryIds)))
  add('材料预算', names(catalog?.budgetTiers, budgetTier))
  add('功能分区', names(catalog?.zones, idsOf(source.zoneIds)))
  add('特色功能', names(catalog?.features, idsOf(source.featureIds)))
  add('必须包含', [...names(catalog?.zones, idsOf(source.requiredZoneIds)), ...names(catalog?.features, idsOf(source.requiredFeatureIds))])
  add('不需要', [...names(catalog?.zones, idsOf(source.excludedZoneIds)), ...names(catalog?.features, idsOf(source.excludedFeatureIds))])
  add('关键词', idsOf(source.keywords))
  const answers = source.applicabilityAnswers && typeof source.applicabilityAnswers === 'object' ? Object.entries(source.applicabilityAnswers as Record<string, unknown>) : []
  add('适用条件', answers.flatMap(([id, answer]) => {
    const label = catalog?.applicabilityQuestions.find(question => question.id === id)?.label
    return label && typeof answer === 'boolean' ? `${label}：${answer ? '是' : '否'}` : []
  }))
  return { specs, groups }
}
