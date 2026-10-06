<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { User, LogIn, LogOut, ChevronDown, Coins, Check, Sparkles } from 'lucide-vue-next'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth'
import { useAuth } from '@/composables/useAuth'
import { useCredits } from '@/composables/useCredits'

const { t } = useI18n()
const route = useRoute()
const authStore = useAuthStore()
const { logout } = useAuth()
const { balance, loading: creditsLoading, signedInToday, fetchBalance, signIn } = useCredits()
const rewardAmount = ref<number | null>(null)

async function handleCheckIn(event: Event) {
  // 保持菜单打开，让用户看到奖励和余额变化
  event.preventDefault()
  if (signedInToday.value || creditsLoading.value) return
  const result = await signIn()
  if (result.success && result.amount) rewardAmount.value = result.amount
}

watch(() => authStore.isLoggedIn, (isLoggedIn) => {
  if (isLoggedIn) {
    void fetchBalance()
  } else {
    balance.value = null
  }
}, { immediate: true })

const LINGTONG_BASE = import.meta.env.VITE_LINGTONG_API_URL ?? 'https://api.lingtong.net.cn'
const avatarUrl = computed(() => {
  const path = authStore.avatarPath
  if (!path) return ''
  return path.startsWith('http') ? path : `${LINGTONG_BASE}${path}`
})

const avatarFallback = computed(() => (authStore.displayName || '?').charAt(0))
</script>

<template>
  <Button v-if="!authStore.isLoggedIn" size="sm" as-child>
    <router-link
      :to="{ path: '/auth/sign-in', query: { redirect: route.fullPath } }"
      :aria-label="t('auth.loginAriaLabel')"
      :title="t('auth.loginTitle')"
    >
      <LogIn class="hidden !size-5 sm:block" aria-hidden="true" />
      <span>{{ t('auth.login') }}</span>
    </router-link>
  </Button>
  <DropdownMenu v-else @update:open="(open: boolean) => { if (!open) rewardAmount = null }">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="h-10 gap-2 px-2" :aria-label="t('auth.accountMenu')">
        <span class="relative">
          <Avatar class="h-8 w-8 rounded-full">
            <AvatarImage :src="avatarUrl" :alt="authStore.displayName" />
            <AvatarFallback class="bg-primary text-primary-foreground">{{ avatarFallback }}</AvatarFallback>
          </Avatar>
          <span v-if="!signedInToday" class="absolute -end-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-primary sm:hidden" aria-hidden="true" />
        </span>
        <div class="hidden min-w-0 flex-col items-start sm:flex">
          <span class="max-w-24 truncate text-sm font-medium leading-none">{{ authStore.displayName }}</span>
          <span class="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Coins class="inline h-3 w-3 text-primary" aria-hidden="true" />
            {{ balance !== null ? `${balance} ${t('auth.credits')}` : '--' }}
            <span v-if="!signedInToday" class="ms-1 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium leading-4 text-primary">{{ t('auth.checkInShort') }}</span>
          </span>
        </div>
        <ChevronDown class="ml-auto hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-56 min-w-[200px]" side="bottom" align="end" :side-offset="8">
      <DropdownMenuLabel class="font-normal p-0">
        <div class="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
          <Avatar class="h-10 w-10 rounded-full">
            <AvatarImage :src="avatarUrl" :alt="authStore.displayName" />
            <AvatarFallback class="bg-primary text-primary-foreground">{{ avatarFallback }}</AvatarFallback>
          </Avatar>
          <div class="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span class="truncate font-semibold">{{ authStore.displayName }}</span>
            <span class="truncate text-xs text-muted-foreground">{{ authStore.currentUser?.email ?? authStore.currentUser?.username }}</span>
            <span class="mt-1 text-xs text-muted-foreground">{{ balance !== null ? `${balance} ${t('auth.credits')}` : t('auth.creditsQuery') }}</span>
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem class="cursor-pointer" :disabled="creditsLoading || (signedInToday && rewardAmount === null)" @select="handleCheckIn">
          <Check v-if="signedInToday" class="mr-2 h-4 w-4" aria-hidden="true" />
          <Sparkles v-else class="mr-2 h-4 w-4 text-primary" aria-hidden="true" />
          <span>{{ signedInToday ? t('auth.checkedIn') : t('auth.checkIn') }}</span>
          <span v-if="rewardAmount !== null" class="ms-auto text-xs font-medium text-primary" role="status">{{ t('auth.creditsEarned', { amount: rewardAmount }) }}</span>
        </DropdownMenuItem>
        <DropdownMenuItem as-child class="cursor-pointer">
          <RouterLink to="/profile">
            <User class="mr-2 h-4 w-4" aria-hidden="true" />
            <span>{{ t('auth.profileAndCredits') }}</span>
          </RouterLink>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem @click="logout" class="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10">
        <LogOut class="mr-2 h-4 w-4" />
        <span>{{ t('auth.logout') }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
