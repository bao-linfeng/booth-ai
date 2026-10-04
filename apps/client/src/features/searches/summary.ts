import type { SearchHistoryItem, SearchRecord, SearchTheme } from '@/services/api/searches'

export const jobStatusLabels: Record<SearchTheme['status'], string> = {
  pending: '等待生成',
  queued: '排队中',
  running: '生成中',
  settling: '结算中',
  succeeded: '已完成',
  partially_succeeded: '部分完成',
  failed: '生成失败',
}

export type JobTone = 'done' | 'active' | 'failed'
const activeStatuses: SearchTheme['status'][] = ['pending', 'queued', 'running', 'settling']

export function jobTone(status: SearchTheme['status']): JobTone {
  if (status === 'succeeded' || status === 'partially_succeeded') return 'done'
  return activeStatuses.includes(status) ? 'active' : 'failed'
}

export interface GenerationSummary { themes: number; artworks: number; active: number; failed: number }

export function summarizeGeneration(items: SearchHistoryItem[]): GenerationSummary {
  const summary: GenerationSummary = { themes: 0, artworks: 0, active: 0, failed: 0 }
  for (const item of items) {
    for (const job of [item.theme, item.artwork]) {
      if (!job) continue
      const tone = jobTone(job.status)
      if (tone === 'active') summary.active++
      else if (tone === 'failed') summary.failed++
    }
    if (item.theme) summary.themes++
    if (item.artwork) summary.artworks++
  }
  return summary
}

export function generationText(summary: GenerationSummary) {
  if (!summary.themes && !summary.artworks) return '尚未生成主题或四面素材'
  return [
    summary.themes ? `换主题 ${summary.themes} 套` : '',
    summary.artworks ? `四面素材 ${summary.artworks} 套` : '',
    summary.active ? `${summary.active} 项生成中` : '',
    summary.failed ? `${summary.failed} 项失败` : '',
  ].filter(Boolean).join(' · ')
}

export function requirementSummary(requirement: SearchRecord['finalRequirement']) {
  const meters = (mm: number) => Number((mm / 1000).toFixed(3))
  return [
    requirement.lengthMm && requirement.widthMm ? `${meters(requirement.lengthMm)} × ${meters(requirement.widthMm)} m` : '',
    requirement.areaM2 ? `${requirement.areaM2} ㎡` : '',
    requirement.openingCount ? `${requirement.openingCount} 面开口` : '',
    requirement.maxHeightMm ? `限高 ${meters(requirement.maxHeightMm)} m` : '',
  ].filter(Boolean)
}
