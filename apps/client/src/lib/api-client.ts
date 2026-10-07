import { ofetch } from 'ofetch'
import { appLocale } from '@/plugins/i18n'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const LINGTONG_API_URL = import.meta.env.VITE_LINGTONG_API_URL ?? 'https://api.lingtong.net.cn'
const API_TIMEOUT = 10000

function visitorId() {
  const key = 'booth-ai:visitor-id'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const created = `v_${crypto.randomUUID().replaceAll('-', '')}`
  localStorage.setItem(key, created)
  return created
}

export function getVisitorId() {
  return visitorId()
}

/** 退出登录时调用，生成新的访客 ID，防止以访客身份读取前一位登录用户的检索记录 */
export function rotateVisitorId() {
  const key = 'booth-ai:visitor-id'
  const created = `v_${crypto.randomUUID().replaceAll('-', '')}`
  localStorage.setItem(key, created)
  return created
}

async function handleUnauthorized() {
  const [{ default: router }, { useAuthStore }, { default: pinia }] = await Promise.all([
    import('@/router'),
    import('@/stores/auth'),
    import('@/plugins/pinia/setup'),
  ])

  const authStore = useAuthStore(pinia)
  if (!authStore.token) return

  authStore.clearAuth()
  await router.push({ path: '/auth/sign-in', query: { redirect: router.currentRoute.value.fullPath } })
}

async function injectBearerToken(options: Parameters<typeof ofetch>[1]) {
  const { useAuthStore } = await import('@/stores/auth')
  const { default: pinia } = await import('@/plugins/pinia/setup')
  const authStore = useAuthStore(pinia)
  if (authStore.token) {
    const headers = new Headers(options?.headers as HeadersInit | undefined)
    headers.set('Authorization', `Bearer ${authStore.token}`)
    if (options) options.headers = headers
  }
}

/** 本地 Fastify API 客户端 */
export const apiFetch = ofetch.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,

  onRequest: async ({ options }) => {
    await injectBearerToken(options)
    const headers = new Headers(options.headers as HeadersInit | undefined)
    headers.set('x-visitor-id', visitorId())
    headers.set('Accept-Language', appLocale.value === 'zh' ? 'zh-CN' : appLocale.value)
    options.headers = headers
  },

  onResponseError: async ({ response }) => {
    if (response.status === 401) {
      await handleUnauthorized()
    }
  },
})

/** 灵通外部公开 API 客户端（无鉴权，用于国家/城市字典等公开接口） */
export const lingtongPublicFetch = ofetch.create({
  baseURL: LINGTONG_API_URL,
  timeout: API_TIMEOUT,
})

/** 灵通外部 API 客户端（登录、用户详情等） */
export const lingtongFetch = ofetch.create({
  baseURL: LINGTONG_API_URL,
  timeout: API_TIMEOUT,

  onRequest: async ({ options }) => {
    await injectBearerToken(options)
  },

  onResponseError: async ({ response }) => {
    if (response.status === 401) {
      await handleUnauthorized()
    }
  },
})
