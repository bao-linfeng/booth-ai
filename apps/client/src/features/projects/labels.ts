import type { ComposerTranslation } from 'vue-i18n'
import type { ProjectStatus } from '@/services/api/projects'

export function getScopeOptions(t: ComposerTranslation) {
  return [
    { code: 'materials', label: t('projects.sourceMaterialsLabel') },
    { code: 'graphics', label: t('projects.sourceGraphicsLabel') },
    { code: 'transport', label: t('projects.sourceTransportLabel') },
    { code: 'installation', label: t('projects.sourceInstallationLabel') },
    { code: 'other', label: t('projects.sourceOtherLabel') },
  ]
}

export function getScopeLabel(code: string, t: ComposerTranslation): string {
  return getScopeOptions(t).find(scope => scope.code === code)?.label ?? t('projects.sourceOtherLabel')
}

export function getProjectStatusLabels(t: ComposerTranslation): Record<ProjectStatus, string> {
  return {
    pending: t('projects.statusLabelPending'),
    following: t('projects.statusLabelFollowing'),
    quoted: t('projects.statusLabelQuoted'),
    won: t('projects.statusLabelWon'),
    lost: t('projects.statusLabelLost'),
    closed: t('projects.statusLabelClosed'),
  }
}
