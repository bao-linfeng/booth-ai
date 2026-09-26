import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserDetail, Role } from '@/services/types/user.type'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const username = ref<string | null>(null)
  const userId = ref<number | null>(null)
  const userDetail = ref<UserDetail | null>(null)

  const isLoggedIn = computed(() => !!token.value)
  const roles = computed<Role[]>(() => userDetail.value?.roles ?? [])
  const avatar = computed(() => userDetail.value?.avatar ?? null)
  const displayName = computed(() =>
    userDetail.value?.nickname
    || userDetail.value?.username
    || username.value
    || ''
  )

  function setAuth(newToken: string, newUsername: string, newUserId: number) {
    token.value = newToken
    username.value = newUsername
    userId.value = newUserId
  }

  function setUserDetail(detail: UserDetail) {
    userDetail.value = detail
  }

  function clearAuth() {
    token.value = null
    username.value = null
    userId.value = null
    userDetail.value = null
  }

  return {
    token,
    username,
    userId,
    userDetail,
    isLoggedIn,
    roles,
    avatar,
    displayName,
    setAuth,
    setUserDetail,
    clearAuth,
  }
}, {
  persist: {
    storage: localStorage,
    pick: ['token', 'username', 'userId', 'userDetail'],
  },
})
