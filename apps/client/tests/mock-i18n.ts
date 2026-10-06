import { ref } from 'vue'
import zh from '../src/plugins/i18n/zh.json'

const currentLocale = ref('zh')

function getNested(obj: any, path: string) {
  if (!obj || !path) return undefined
  return path.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj)
}

function format(template: string, params?: Record<string, any>) {
  if (!template || !params) return template || ''
  return Object.entries(params).reduce((res, [k, v]) => res.replaceAll('{' + k + '}', String(v)), template)
}

export function t(key: string, params?: Record<string, any>) {
  const val = getNested(zh, key) ?? key
  return typeof params === 'object' && params ? format(String(val), params) : String(val)
}

export function useI18n() {
  return { t, locale: currentLocale }
}

export function createI18n() {
  return {
    install(app: any) {
      app.config.globalProperties.$t = t
    },
    global: { t, locale: currentLocale, availableLocales: ['zh', 'en'], setLocaleMessage() {} },
  }
}
