import type { NavigationGuard } from 'vue-router'
import { syncAuthApi } from '@/services/api/auth.api'
import { useAuthStore } from '@/stores/auth'
import pinia from '@/plugins/pinia/setup'

export const externalLoginGuard: NavigationGuard = async (to) => {
  if (to.path !== '/' || !('token' in to.query || 'username' in to.query)) return

  const { token, username, ...query } = to.query
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) search.append(key, item ?? '')
    }
  }
  const cleanedUrl = `${to.path}${search.size ? `?${search}` : ''}${to.hash}`
  window.history.replaceState(window.history.state, '', cleanedUrl)

  const authStore = useAuthStore(pinia)
  authStore.clearAuth()
  if (typeof token === 'string' && token.trim() && typeof username === 'string' && username.trim()) {
    try {
      const response = await syncAuthApi({ token, username })
      if (response.code === 0) {
        authStore.setLoginResult(response.data.accessToken, response.data.user)
        return { path: to.path, query, hash: to.hash, replace: true }
      }
    } catch {}
  }
  return { path: '/auth/sign-in', query: { redirect: cleanedUrl }, replace: true }
}
