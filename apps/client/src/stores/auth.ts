import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CurrentUser } from '@/services/types/user.type'
import { rotateVisitorId } from '@/lib/api-client'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const currentUser = ref<CurrentUser | null>(null)

  const isLoggedIn = computed(() => !!token.value)
  const displayName = computed(() => currentUser.value?.nickname || currentUser.value?.username || '')
  const avatarPath = computed(() => currentUser.value?.avatarPath ?? null)
  const roles = computed(() => currentUser.value?.roles ?? [])

  // 账号密码、微信与外部登录都经过这里：登录后把本机的客服访客会话合并到账号（失败不影响登录）
  function setLoginResult(accessToken: string, user: CurrentUser) {
    token.value = accessToken
    currentUser.value = user
    void import('@/features/customer-service/useCustomerService').then(module => module.handleCustomerServiceLogin()).catch(() => undefined)
  }

  function setCurrentUser(user: CurrentUser) {
    currentUser.value = user
  }

  function clearAuth() {
    const wasLoggedIn = Boolean(token.value)
    token.value = null
    currentUser.value = null
    rotateVisitorId()
    // 退出登录时清空客服会话状态；未登录时调用（如外部登录前）保留访客标记与 Cookie，以便登录后合并
    if (wasLoggedIn) void import('@/features/customer-service/useCustomerService').then(module => module.resetCustomerService()).catch(() => undefined)
  }

  return {
    token,
    currentUser,
    isLoggedIn,
    displayName,
    avatarPath,
    roles,
    setLoginResult,
    setCurrentUser,
    clearAuth,
  }
}, {
  persist: {
    storage: localStorage,
    pick: ['token', 'currentUser'],
  },
})
