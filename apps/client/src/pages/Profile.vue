<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import CreditSignIn from '@/components/ui/CreditSignIn.vue'

const router = useRouter()
const authStore = useAuthStore()

const user = computed(() => authStore.currentUser)

const LINGTONG_BASE = import.meta.env.VITE_LINGTONG_API_URL ?? 'https://api.lingtong.net.cn'
const avatarUrl = computed(() => {
  const path = authStore.avatarPath
  if (!path) return ''
  return path.startsWith('http') ? path : `${LINGTONG_BASE}${path}`
})
const avatarFallback = computed(() => authStore.displayName.charAt(0) || '?')

onMounted(() => {
  if (!authStore.isLoggedIn) {
    router.replace('/auth/sign-in')
  }
})

const handleEdit = () => {
  alert('功能开发中')
}

const formatExternalId = (id?: string) => {
  if (!id) return '未知'
  if (id.length <= 8) return id
  return id.substring(0, 8) + '...'
}
</script>

<template>
  <div class="max-w-2xl mx-auto px-4 py-8 space-y-6">
    <Card class="flex items-center p-6 gap-6 shadow-sm border-border">
      <Avatar class="h-20 w-20">
        <AvatarImage :src="avatarUrl" :alt="authStore.displayName" />
        <AvatarFallback class="bg-primary text-primary-foreground text-2xl">
          {{ avatarFallback }}
        </AvatarFallback>
      </Avatar>
      <div class="flex-1 space-y-1">
        <h2 class="text-xl font-bold tracking-tight">{{ user?.username }}</h2>
        <p v-if="user?.nickname" class="text-sm text-muted-foreground">{{ user.nickname }}</p>
        <p v-if="user?.email || user?.mobile" class="text-sm text-muted-foreground">
          {{ user.email || user.mobile }}
        </p>
      </div>
      <Button variant="outline" size="sm" @click="handleEdit">编辑资料</Button>
    </Card>

    <CreditSignIn />

    <Card class="shadow-sm border-border">
      <CardHeader>
        <CardTitle class="text-lg">账户信息</CardTitle>
      </CardHeader>
      <CardContent>
        <dl class="space-y-4 text-sm">
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">用户名</dt>
            <dd class="font-medium">{{ user?.username }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">昵称</dt>
            <dd class="font-medium">{{ user?.nickname ?? '未设置' }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">邮箱</dt>
            <dd class="font-medium">{{ user?.email ?? '未绑定' }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">手机</dt>
            <dd class="font-medium">{{ user?.mobile ?? '未绑定' }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">公司</dt>
            <dd class="font-medium">{{ user?.company ?? '未填写' }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">城市</dt>
            <dd class="font-medium">{{ user?.city ?? '未填写' }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">账户类型</dt>
            <dd class="font-medium">{{ user?.accountType === 'client' ? '参展商' : '管理员' }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">注册来源</dt>
            <dd class="font-medium text-muted-foreground font-mono text-xs">{{ formatExternalId(user?.externalUserId) }}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  </div>
</template>
