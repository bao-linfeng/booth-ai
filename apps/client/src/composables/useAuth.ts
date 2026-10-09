import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { login as loginUser, logout as logoutUser } from '@/services/api/auth'
import { fetchCurrentUser } from '@/services/api/user'
import { useI18n } from 'vue-i18n'

let loggingOut: Promise<void> | null = null

export function useAuth() {
  const router = useRouter()
  const route = useRoute()
  const authStore = useAuthStore()
  const { t } = useI18n()
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function login(username: string, password: string) {
    loading.value = true
    error.value = null
    try {
      const result = await loginUser({ username, password })
      authStore.setLoginResult(result.accessToken, result.user)
      const redirect = route.query.redirect
      await router.push(typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/')
    } catch {
      error.value = t('auth.loginFailed')
    } finally {
      loading.value = false
    }
  }

  async function loginWithWechat() {
    // TODO: 接入微信 OAuth
    loading.value = true
    error.value = null
    try {
      const base = import.meta.env.VITE_LINGTONG_API_URL ?? 'https://api.lingtong.net.cn'
      window.location.href = `${base}/api/auth/wechat`
    } finally {
      loading.value = false
    }
  }

  // 防重入：多次点击或多个组件同时触发时只撤销一次服务端会话、只清理并跳转一次
  async function logout() {
    if (loggingOut) return loggingOut
    loggingOut = (async () => {
      try { await logoutUser() } catch {}
      authStore.clearAuth()
      await router.push('/auth/sign-in')
    })().finally(() => { loggingOut = null })
    return loggingOut
  }

  async function restoreSession() {
    if (!authStore.token) return
    try {
      const user = await fetchCurrentUser()
      authStore.setCurrentUser(user)
    } catch {
      authStore.clearAuth()
    }
  }

  return {
    login,
    loginWithWechat,
    logout,
    restoreSession,
    loading,
    error,
    isLoggedIn: authStore.isLoggedIn,
    displayName: authStore.displayName,
  }
}
