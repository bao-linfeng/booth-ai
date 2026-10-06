<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import CreditSignIn from '@/components/ui/CreditSignIn.vue'
import MainLayout from '@/layouts/MainLayout.vue'

const { t } = useI18n()
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
  alert(t('profile.featureInDev'))
}

const formatExternalId = (id?: string) => {
  if (!id) return t('common.unknown')
  if (id.length <= 8) return id
  return id.substring(0, 8) + '...'
}
</script>

<template>
  <MainLayout>
    <main id="main-content" class="studio-page">
    <header class="studio-header"><p class="studio-eyebrow">{{ t('profile.title') }}</p><h1 class="studio-title">{{ t('profile.heading') }}</h1></header>
    <div class="max-w-2xl space-y-6">
    <CreditSignIn class="w-full" />

    <Card class="shadow-sm border-border">
      <CardHeader>
        <CardTitle class="text-lg">{{ t('profile.accountInfo') }}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl class="space-y-4 text-sm">
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">{{ t('profile.username') }}</dt>
            <dd class="font-medium">{{ user?.username }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">{{ t('profile.nickname') }}</dt>
            <dd class="font-medium">{{ user?.nickname ?? t('common.notSet') }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">{{ t('profile.email') }}</dt>
            <dd class="font-medium">{{ user?.email ?? t('common.notBound') }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">{{ t('profile.phone') }}</dt>
            <dd class="font-medium">{{ user?.mobile ?? t('common.notBound') }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">{{ t('profile.company') }}</dt>
            <dd class="font-medium">{{ user?.company ?? t('common.notFilled') }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">{{ t('profile.city') }}</dt>
            <dd class="font-medium">{{ user?.city ?? t('common.notFilled') }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">{{ t('profile.accountType') }}</dt>
            <dd class="font-medium">{{ user?.accountType === 'client' ? t('profile.typeExhibitor') : t('profile.typeAdmin') }}</dd>
          </div>
          <Separator />
          <div class="flex justify-between items-center">
            <dt class="text-muted-foreground">{{ t('profile.registrationSource') }}</dt>
            <dd class="font-medium text-muted-foreground font-mono text-xs">{{ formatExternalId(user?.externalUserId) }}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
    </div>
    </main>
  </MainLayout>
</template>
