import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { login as loginApi } from '@/services/api/auth.api'
import { fetchUserByUsername } from '@/services/api/user.api'

export function useAuth() {
  const router = useRouter()
  const authStore = useAuthStore()
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function login(username: string, password: string) {
    loading.value = true
    error.value = null
    try {
      const res = await loginApi({ username, password })
      if (res.code !== '200' || !res.success) {
        error.value = res.msg || '登录失败'
        return
      }
      const { JWT, data } = res.data
      authStore.setAuth(JWT, data.username, data.id)

      // 登录成功后拉取完整用户详情
      try {
        const userRes = await fetchUserByUsername(data.username)
        if (userRes.code === '200' && userRes.success) {
          authStore.setUserDetail(userRes.data)
        }
      } catch {
        // 用户详情拉取失败不阻断登录流程
      }

      await router.push('/')
    } catch (e) {
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
    authStore.clearAuth()
    await router.push('/auth/sign-in')
  }

  return {
    login,
    loginWithWechat,
    logout,
    loading,
    error,
    isLoggedIn: authStore.isLoggedIn,
    displayName: authStore.displayName,
  }
}
