import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { login as loginUser, logout } from '@/services/api/auth'
import { fetchCurrentUser } from '@/services/api/user'

export function useAuth() {
  const router = useRouter()
  const route = useRoute()
  const authStore = useAuthStore()
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
      error.value = '登录失败，请检查用户名和密码'
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

  async function logout() {
    try { await logout() } catch {}
    authStore.clearAuth()
    await router.push('/auth/sign-in')
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
