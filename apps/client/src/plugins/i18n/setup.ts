import type { App, Ref } from 'vue'
import { createI18n } from 'vue-i18n'
import type { Language } from '.'
import { appLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES, validateAppLocale } from '.'

let i18nInstance: ReturnType<typeof createI18n> | null = null
const localeModules = import.meta.glob<{ default: Record<string, any> }>('./*.json')

async function loadLocaleMessages(locale: Language): Promise<Record<string, any>> {
  const loadMessages = localeModules[`./${locale}.json`]
  if (!loadMessages) throw new Error(`Missing locale messages: ${locale}`)
  const messages = await loadMessages()
  return messages.default
}

export async function setupI18n(app: App) {
  validateAppLocale()
  const locale = appLocale.value
  const [messages, englishMessages, fallbackMessages] = await Promise.all([
    loadLocaleMessages(locale),
    loadLocaleMessages('en'),
    loadLocaleMessages(DEFAULT_LOCALE),
  ])

  i18nInstance = createI18n({
    legacy: false,
    locale,
    fallbackLocale: ['en', DEFAULT_LOCALE],
    messages: {
      [locale]: messages,
      en: englishMessages,
      [DEFAULT_LOCALE]: fallbackMessages,
    } as Record<Language, Record<string, any>>,
  })

  app.use(i18nInstance)
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale === 'en' ? 'en-US' : locale
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
}

export async function loadAndSetLocale(locale: Language) {
  if (!i18nInstance) return
  const { global } = i18nInstance
  if (!SUPPORTED_LOCALES.has(locale)) return

  if (!global.availableLocales.includes(locale)) {
    const messages = await loadLocaleMessages(locale)
    global.setLocaleMessage(locale, messages)
  }

  if (!global.availableLocales.includes('en')) {
    global.setLocaleMessage('en', await loadLocaleMessages('en'))
  }
  if (!global.availableLocales.includes(DEFAULT_LOCALE)) {
    global.setLocaleMessage(DEFAULT_LOCALE, await loadLocaleMessages(DEFAULT_LOCALE))
  }

  ;(global.locale as Ref<Language>).value = locale
  appLocale.value = locale
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale === 'en' ? 'en-US' : locale
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
}
