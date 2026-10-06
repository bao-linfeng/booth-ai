import type { ComposerTranslation } from 'vue-i18n'

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
