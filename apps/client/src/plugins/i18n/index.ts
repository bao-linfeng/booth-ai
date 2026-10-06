import { ref } from 'vue'
import { useStorage } from '@vueuse/core'

export type Language = 'zh' | 'en' | 'fr' | 'de' | 'ja' | 'ru' | 'it' | 'es' | 'ar' | 'hi' | 'pt' | 'ms'

export const SUPPORTED_LOCALES = new Set<Language>([
  'zh', 'en', 'fr', 'de', 'ja', 'ru', 'it', 'es', 'ar', 'hi', 'pt', 'ms',
])

export const DEFAULT_LOCALE: Language = 'zh'

export const appLocale = typeof window !== 'undefined' && typeof Storage !== 'undefined'
  ? useStorage<Language>('app-locale', DEFAULT_LOCALE)
  : ref<Language>(DEFAULT_LOCALE)

export const toIntlLocale = (locale: Language) => (locale === 'zh' ? 'zh-CN' : locale)

export function validateAppLocale() {
  if (!SUPPORTED_LOCALES.has(appLocale.value)) {
    appLocale.value = DEFAULT_LOCALE
  }
}
