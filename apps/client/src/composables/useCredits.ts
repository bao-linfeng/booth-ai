import { ref } from 'vue'
import { getCreditBalanceApi, signInForCreditsApi } from '@/services/api/credits'

export function useCredits() {
  const balance = ref<number | null>(null)
  const loading = ref(false)
  const signedInToday = ref(false)

  // Initialize signedInToday state from localStorage
  const lastSignInKey = 'booth-ai:last-sign-in'
  const todayStr = new Date().toLocaleDateString()
  if (localStorage.getItem(lastSignInKey) === todayStr) {
    signedInToday.value = true
  }

  async function fetchBalance() {
    loading.value = true
    try {
      const data = await getCreditBalanceApi()
      balance.value = data.balance
    } catch (e) {
      console.error('Failed to fetch balance', e)
    } finally {
      loading.value = false
    }
  }

  async function signIn(): Promise<{ success: boolean; alreadySigned?: boolean; amount?: number }> {
    loading.value = true
    try {
      const data = await signInForCreditsApi()
      balance.value = data.balance
      signedInToday.value = true
      localStorage.setItem(lastSignInKey, new Date().toLocaleDateString())
      return { success: true, amount: data.amount }
    } catch (error: any) {
      if (error.response?.status === 409) {
        signedInToday.value = true
        localStorage.setItem(lastSignInKey, new Date().toLocaleDateString())
        return { success: false, alreadySigned: true }
      }
      console.error('Sign in failed', error)
      return { success: false }
    } finally {
      loading.value = false
    }
  }

  return {
    balance,
    loading,
    signedInToday,
    fetchBalance,
    signIn
  }
}
