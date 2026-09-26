<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { User, LogOut, ChevronsUpDown } from 'lucide-vue-next'
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
import { useAuth } from '@/composables/use-auth'

const router = useRouter()
const authStore = useAuthStore()
const { logout } = useAuth()

const LINGTONG_BASE = import.meta.env.VITE_LINGTONG_API_URL ?? 'https://api.lingtong.net.cn'
const avatarUrl = computed(() => {
  const path = authStore.avatarPath
  if (!path) return ''
  return path.startsWith('http') ? path : `${LINGTONG_BASE}${path}`
})

const avatarFallback = computed(() => authStore.displayName.charAt(0) || '?')
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="h-8 gap-2 px-2">
        <Avatar class="h-8 w-8 rounded-full">
          <AvatarImage :src="avatarUrl" :alt="authStore.displayName" />
          <AvatarFallback class="bg-primary text-primary-foreground">{{ avatarFallback }}</AvatarFallback>
        </Avatar>
        <div class="hidden flex-col items-start md:flex">
          <span class="text-sm font-medium leading-none">{{ authStore.displayName }}</span>
          <span class="text-xs text-muted-foreground mt-1">{{ authStore.currentUser?.username }}</span>
        </div>
        <ChevronsUpDown class="h-4 w-4 text-muted-foreground ml-auto hidden md:block" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-56 min-w-[200px]" side="bottom" align="end" :side-offset="8">
      <DropdownMenuLabel class="font-normal p-0">
        <div class="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
          <Avatar class="h-10 w-10 rounded-full">
            <AvatarImage :src="avatarUrl" :alt="authStore.displayName" />
            <AvatarFallback class="bg-primary text-primary-foreground">{{ avatarFallback }}</AvatarFallback>
          </Avatar>
          <div class="grid flex-1 text-left text-sm leading-tight">
            <span class="truncate font-semibold">{{ authStore.displayName }}</span>
            <span class="truncate text-xs text-muted-foreground">{{ authStore.currentUser?.email ?? authStore.currentUser?.username }}</span>
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem @click="router.push('/profile')" class="cursor-pointer">
          <User class="mr-2 h-4 w-4" />
          <span>个人中心</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem @click="logout" class="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10">
        <LogOut class="mr-2 h-4 w-4" />
        <span>退出登录</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
