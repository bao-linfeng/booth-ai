import type { Direction } from '@/services/api/artwork-jobs'
import type { ComposerTranslation } from 'vue-i18n'

export function getDirectionLabels(t: ComposerTranslation): Record<Direction, string> {
  return {
    front: t('artworkJob.directionFront'),
    back: t('artworkJob.directionBack'),
    left: t('artworkJob.directionLeft'),
    right: t('artworkJob.directionRight'),
  }
}

export function getReasonLabels(t: ComposerTranslation): Record<string, string> {
  return {
    ARTWORK_RESOLUTION_TOO_LOW: t('artworkJob.reasonResolutionLow'),
    ARTWORK_FORMAT_INVALID: t('artworkJob.reasonFormatInvalid'),
    ARTWORK_IMAGE_INVALID: t('artworkJob.reasonImageInvalid'),
    ARTWORK_SIZE_INVALID: t('artworkJob.reasonSizeInvalid'),
    MODEL_UNAVAILABLE: t('artworkJob.reasonModelUnavailable'),
    PROVIDER_OUTCOME_UNKNOWN: t('artworkJob.reasonProviderUnknown'),
    PROCESSING_FAILED: t('artworkJob.reasonProcessingFailed'),
  }
}
