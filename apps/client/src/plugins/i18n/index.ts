import { useStorage } from '@vueuse/core'

export type Language = 'en' | 'zh'

export const SUPPORTED_LOCALES = new Set<Language>([
  'en',
  'zh',
])

export const DEFAULT_LOCALE: Language = 'zh'

function detectSystemLocale(): Language {
  const systemLang = navigator.language.split('-')[0] as Language
  return SUPPORTED_LOCALES.has(systemLang) ? systemLang : DEFAULT_LOCALE
}

export const appLocale = useStorage<Language>('app-locale', detectSystemLocale())

export function validateAppLocale() {
  if (!SUPPORTED_LOCALES.has(appLocale.value)) {
    appLocale.value = DEFAULT_LOCALE
  }
}
