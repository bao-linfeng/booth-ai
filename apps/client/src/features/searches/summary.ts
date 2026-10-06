import type { SearchHistoryItem, SearchRecord, SearchTheme } from '@/services/api/searches'
import type { ComposerTranslation } from 'vue-i18n'

export function getJobStatusLabels(t: ComposerTranslation): Record<SearchTheme['status'], string> {
  return {
    pending: t('searches.jobPending'),
    queued: t('searches.jobQueued'),
    running: t('searches.jobRunning'),
    settling: t('searches.jobSettling'),
    succeeded: t('searches.jobSucceeded'),
    partially_succeeded: t('searches.jobPartialSuccess'),
    failed: t('searches.jobFailed'),
  }
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

export function generationText(summary: GenerationSummary, t: ComposerTranslation): string {
  if (!summary.themes && !summary.artworks) return t('searches.generationNone')
  return [
    summary.themes ? t('searches.generationThemes', { count: summary.themes }) : '',
    summary.artworks ? t('searches.generationArtworks', { count: summary.artworks }) : '',
    summary.active ? t('searches.generationActive', { count: summary.active }) : '',
    summary.failed ? t('searches.generationFailed', { count: summary.failed }) : '',
  ].filter(Boolean).join(' · ')
}

export function requirementSummary(requirement: SearchRecord['finalRequirement'], t: ComposerTranslation) {
  const meters = (mm: number) => Number((mm / 1000).toFixed(3))
  return [
    requirement.lengthMm && requirement.widthMm ? `${meters(requirement.lengthMm)} × ${meters(requirement.widthMm)} m` : '',
    requirement.areaM2 ? `${requirement.areaM2} ㎡` : '',
    requirement.openingCount ? t('searches.requirementOpening', { count: requirement.openingCount }) : '',
    requirement.maxHeightMm ? t('searches.requirementMaxHeight', { value: meters(requirement.maxHeightMm) }) : '',
  ].filter(Boolean)
}
