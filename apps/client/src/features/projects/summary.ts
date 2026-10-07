import type { Catalog, Option } from '@/features/selection/types'
import type { ProjectStatus } from '@/services/api/projects'
import type { ComposerTranslation } from 'vue-i18n'
import { DEFAULT_LOCALE, toIntlLocale, type Language } from '@/plugins/i18n'

// 下一步只描述当前状态下用户可以做的事，不承诺处理时限或报价金额。
export function getNextSteps(t: ComposerTranslation): Record<ProjectStatus, string> {
  return {
    pending: t('projects.statusPending'),
    following: t('projects.statusFollowing'),
    quoted: t('projects.statusQuoted'),
    won: t('projects.statusWon'),
    lost: t('projects.statusLost'),
    closed: t('projects.statusClosed'),
  }
}

export const closedStatuses: ProjectStatus[] = ['won', 'lost', 'closed']

export function regionName(code?: string | null, locale: Language = DEFAULT_LOCALE) {
  if (!code) return ''
  try { return new Intl.DisplayNames([toIntlLocale(locale)], { type: 'region' }).of(code.toUpperCase()) ?? code } catch { return code }
}

export function joinParts(parts: Array<string | null | undefined | false>, separator = ' · ') {
  return parts.filter((part): part is string => !!part).join(separator)
}

export function dateRange(start?: string | null, end?: string | null, t?: ComposerTranslation) {
  if (start && end && start !== end) return t ? t('controls.dateRange', { start, end }) : `${start} – ${end}`
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
export function summarizeRequirement(raw: unknown, catalog: Catalog | null, t: ComposerTranslation): RequirementSummary {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const length = numberOf(source.lengthMm), width = numberOf(source.widthMm)
  const area = numberOf(source.areaM2), height = numberOf(source.maxHeightMm), openings = numberOf(source.openingCount)
  const specs = [
    length && width ? `${meters(length)} × ${meters(width)}` : '',
    area ? `${area} ㎡` : '',
    openings ? t('projects.requirementOpenings', { count: openings }) : '',
    height ? t('projects.requirementMaxHeight', { value: meters(height) }) : '',
  ].filter(Boolean)
  const names = (options: Option[] | undefined, ids: string[]) => ids.flatMap(id => options?.find(option => option.id === id)?.label ?? [])
  const groups: RequirementSummary['groups'] = []
  const add = (label: string, values: string[]) => { if (values.length) groups.push({ label, values }) }
  const productSystem = typeof source.productSystemId === 'string' ? [source.productSystemId] : []
  const budgetTier = typeof source.budgetTierId === 'string' ? [source.budgetTierId] : []
  add(t('projects.requirementProductSystem'), names(catalog?.productSystems, productSystem))
  add(t('projects.requirementStyle'), names(catalog?.styles, idsOf(source.styleIds)))
  add(t('projects.requirementIndustry'), names(catalog?.industries, idsOf(source.industryIds)))
  add(t('projects.requirementBudget'), names(catalog?.budgetTiers, budgetTier))
  add(t('projects.requirementZones'), names(catalog?.zones, idsOf(source.zoneIds)))
  add(t('projects.requirementFeatures'), names(catalog?.features, idsOf(source.featureIds)))
  add(t('projects.requirementRequired'), [...names(catalog?.zones, idsOf(source.requiredZoneIds)), ...names(catalog?.features, idsOf(source.requiredFeatureIds))])
  add(t('projects.requirementExcluded'), [...names(catalog?.zones, idsOf(source.excludedZoneIds)), ...names(catalog?.features, idsOf(source.excludedFeatureIds))])
  add(t('projects.requirementKeywords'), idsOf(source.keywords))
  return { specs, groups }
}
