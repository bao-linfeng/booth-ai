import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CurrentUser } from '@/services/types/user.type'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const currentUser = ref<CurrentUser | null>(null)

  const isLoggedIn = computed(() => !!token.value)
  const displayName = computed(() => currentUser.value?.nickname || currentUser.value?.username || '')
  const avatarPath = computed(() => currentUser.value?.avatarPath ?? null)
  const roles = computed(() => currentUser.value?.roles ?? [])

  function setLoginResult(accessToken: string, user: CurrentUser) {
    token.value = accessToken
    currentUser.value = user
  }

  function setCurrentUser(user: CurrentUser) {
    currentUser.value = user
  }

  function clearAuth() {
    token.value = null
    currentUser.value = null
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
