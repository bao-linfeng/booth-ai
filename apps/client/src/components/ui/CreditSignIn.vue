<template>
  <Card class="relative overflow-hidden w-full max-w-sm">
    <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
    
    <CardHeader class="pb-2">
      <CardTitle class="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Coins class="w-5 h-5 text-yellow-500" />
        我的积分
      </CardTitle>
    </CardHeader>

    <CardContent>
      <div class="flex items-end justify-between">
        <div class="flex flex-col">
          <span class="text-sm text-muted-foreground mb-1">当前余额</span>
          <div v-if="loading && balance === null" class="h-9 w-24">
            <Skeleton class="h-full w-full rounded-md" />
          </div>
          <div v-else class="text-3xl font-bold tracking-tight text-foreground flex items-baseline gap-1">
            {{ balance ?? 0 }}
            <span class="text-sm font-medium text-muted-foreground">分</span>
          </div>
        </div>

        <div class="relative">
          <Button 
            @click="handleSignIn" 
            :disabled="loading || signedInToday"
            :variant="signedInToday ? 'secondary' : 'default'"
            class="transition-all duration-300 relative z-10"
            :class="[
              signedInToday ? 'opacity-80' : 'hover:scale-105 active:scale-95 shadow-md shadow-primary/20'
            ]"
          >
            <Check v-if="signedInToday" class="w-4 h-4 mr-2" />
            <Sparkles v-else class="w-4 h-4 mr-2" />
            {{ signedInToday ? '今日已签到' : '每日签到' }}
          </Button>

          <!-- Reward Animation -->
          <Transition name="reward-float">
            <div 
              v-if="showRewardAnimation" 
              class="absolute -top-10 left-1/2 -translate-x-1/2 font-bold text-yellow-500 whitespace-nowrap text-lg select-none pointer-events-none flex items-center gap-1 z-20"
            >
              +{{ rewardAmount }}
              <Coins class="w-4 h-4" />
            </div>
          </Transition>
        </div>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Check, Coins, Sparkles } from 'lucide-vue-next'
import { useCredits } from '@/composables/useCredits'

const { balance, loading, signedInToday, fetchBalance, signIn } = useCredits()

const showRewardAnimation = ref(false)
const rewardAmount = ref(0)
const isSigningIn = ref(false)

onMounted(() => {
  fetchBalance()
})

async function handleSignIn() {
  if (signedInToday.value || isSigningIn.value) return
  
  isSigningIn.value = true
  const result = await signIn()
  isSigningIn.value = false
  
  if (result.success && result.amount) {
    rewardAmount.value = result.amount
    showRewardAnimation.value = true
    
    // Hide animation after 2s
    setTimeout(() => {
      showRewardAnimation.value = false
    }, 2000)
  }
}
</script>

<style scoped>
.reward-float-enter-active {
  transition: all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.reward-float-leave-active {
  transition: all 0.4s ease-in;
}
.reward-float-enter-from {
  opacity: 0;
  transform: translate(-50%, 20px) scale(0.5);
}
.reward-float-enter-to {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
.reward-float-leave-from {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
.reward-float-leave-to {
  opacity: 0;
  transform: translate(-50%, -20px) scale(0.8);
}
</style>
