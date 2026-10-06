import { computed, ref } from 'vue'
import { getCreditBalance, signInForCredits } from '@/services/api/credits'
import { useAuthStore } from '@/stores/auth'

// 模块级共享状态：导航栏、个人中心、主题页读写同一份余额与签到状态
const balance = ref<number | null>(null)
const loading = ref(false)
// 签到标记存在 localStorage 中，读取不具备响应性，写入后递增此计数触发重新计算
const signInVersion = ref(0)

const lastSignInKey = (userId: string) => `booth-ai:last-sign-in:${userId}`
const todayStr = () => new Date().toLocaleDateString()

export function useCredits() {
  const authStore = useAuthStore()

  const signedInToday = computed(() => {
    void signInVersion.value
    const userId = authStore.currentUser?.id
    return !!userId && localStorage.getItem(lastSignInKey(userId)) === todayStr()
  })

  function markSignedIn() {
    const userId = authStore.currentUser?.id
    if (!userId) return
    localStorage.setItem(lastSignInKey(userId), todayStr())
    signInVersion.value++
  }

  async function fetchBalance() {
    loading.value = true
    // 跨天后重新判断签到状态
    signInVersion.value++
    try {
      const data = await getCreditBalance()
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
      const data = await signInForCredits()
      balance.value = data.balance
      markSignedIn()
      return { success: true, amount: data.amount }
    } catch (error: any) {
      if (error.response?.status === 409) {
        markSignedIn()
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
