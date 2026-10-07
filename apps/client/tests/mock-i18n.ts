import { defineComponent, h, ref } from 'vue'
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

// 对应 vue-i18n 的 <i18n-t>：按 keypath 取文案，把 {name} 占位替换为同名插槽
export const Translation = defineComponent({
  name: 'I18nT',
  props: { keypath: { type: String, required: true }, tag: { type: String, default: 'span' }, scope: String },
  setup(props, { slots }) {
    return () => h(props.tag, String(getNested(zh, props.keypath) ?? props.keypath).split(/(\{\w+\})/).filter(Boolean).map(part => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1]
      const slot = name ? slots[name] : undefined
      return slot ? slot() : part
    }))
  },
})

export function createI18n() {
  return {
    install(app: any) {
      app.config.globalProperties.$t = t
      app.component('i18n-t', Translation)
    },
    global: { t, locale: currentLocale, availableLocales: ['zh', 'en'], setLocaleMessage() {} },
  }
}
