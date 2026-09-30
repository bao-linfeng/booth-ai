import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { loginApi, logoutApi } from '@/services/api/auth.api'
import { fetchCurrentUser } from '@/services/api/user.api'

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
      const res = await loginApi({ username, password })
      if (res.code !== 0) {
        error.value = res.message || '登录失败'
        return
      }
      authStore.setLoginResult(res.data.accessToken, res.data.user)
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
    try { await logoutApi() } catch {}
    authStore.clearAuth()
    await router.push('/auth/sign-in')
  }

  async function restoreSession() {
    if (!authStore.token) return
    try {
      const res = await fetchCurrentUser()
      if (res.code === 0) {
        authStore.setCurrentUser(res.data)
      } else {
        authStore.clearAuth()
        await router.push('/auth/sign-in')
      }
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
