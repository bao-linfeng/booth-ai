import type { ThemeJob } from '@/services/api/theme-jobs'
import type { ComposerTranslation } from 'vue-i18n'

export function getThemeJobStatusLabels(t: ComposerTranslation): Record<ThemeJob['status'], string> {
  return {
    pending: t('searches.jobPending'),
    queued: t('searches.jobQueued'),
    running: t('searches.jobRunning'),
    settling: t('searches.jobSettling'),
    succeeded: t('themeJob.statusSucceeded'),
    partially_succeeded: t('searches.jobPartialSuccess'),
    failed: t('searches.jobFailed'),
  }
}

export function phaseText(job: ThemeJob | null, t: ComposerTranslation): string {
  if (!job) return t('common.loading')
  if (job.status === 'queued') return t('searches.jobQueued')
  if (job.status === 'running') return t('themeJob.phaseGenerating')
  if (job.status === 'settling') return t('searches.jobSettling')
  if (job.phase === 'rendering') return t('themeJob.phaseGenerating')
  return job.phase || t('common.loading')
}

export function failureReasonText(reason: string | null | undefined, t: ComposerTranslation): string {
  if (!reason) return t('common.unknown')
  const labels: Record<string, string> = {
    INSUFFICIENT_CREDITS: t('themeJob.failureInsufficientCredits'),
    PROVIDER_ERROR: t('themeJob.failureProviderError'),
    INTERNAL_ERROR: t('themeJob.failureInternalError'),
  }
  return labels[reason] || reason
}

export function blockedReasonText(reasons: string[], t: ComposerTranslation): string {
  if (reasons.includes('MODEL_UNAVAILABLE')) return t('schemeTheme.errorServiceUnavailable')
  if (reasons.includes('MASK_UNAVAILABLE')) return t('schemeTheme.errorMaskUnavailable')
  if (reasons.includes('TEMPLATE_UNAVAILABLE')) return t('schemeTheme.errorTemplateUnavailable')
  return t('schemeTheme.errorBlocked')
}
