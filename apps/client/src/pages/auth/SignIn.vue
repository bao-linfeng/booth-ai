<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/composables/useAuth'

const username = ref('')
const password = ref('')
const { login, loading, error } = useAuth()
const { t } = useI18n()

const handleLogin = async () => {
  if (!username.value || !password.value) return
  await login(username.value, password.value)
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen p-4 min-w-screen bg-background">
    <main class="flex flex-col gap-6 w-full max-w-sm">
      <div class="flex flex-col items-center gap-2 text-center">
        <h1 class="text-2xl font-bold tracking-tight">{{ t('nav.brand') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('auth.loginSubtitle') }}</p>
      </div>
      <Card class="w-full">
        <CardHeader>
          <CardTitle class="text-2xl">{{ t('auth.login') }}</CardTitle>
          <CardDescription>
            {{ t('auth.loginDescription') }}
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-4">
          <div class="grid gap-2">
            <Label for="username">{{ t('auth.username') }}</Label>
            <Input id="username" v-model="username" type="text" :placeholder="t('auth.usernamePlaceholder')" required />
          </div>
          <div class="grid gap-2">
            <Label for="password">{{ t('auth.password') }}</Label>
            <Input id="password" v-model="password" type="password" required placeholder="*********" @keyup.enter="handleLogin" />
          </div>
          <div class="flex items-center justify-between">
            <a href="https://lingtong.net.cn/forgetPassword" target="_blank" rel="noopener noreferrer" class="text-sm text-muted-foreground underline-offset-4 hover:underline">{{ t('auth.forgotPassword') }}</a>
            <a href="https://lingtong.net.cn/register" target="_blank" rel="noopener noreferrer" class="text-sm text-muted-foreground underline-offset-4 hover:underline">{{ t('auth.register') }}</a>
          </div>
          <div v-if="error" class="text-sm text-destructive font-medium">{{ error }}</div>
          <Button class="w-full" @click="handleLogin" :disabled="loading">
            <span v-if="loading">{{ t('auth.loggingIn') }}</span>
            <span v-else>{{ t('auth.login') }}</span>
          </Button>
        </CardContent>
      </Card>
      <div class="text-center text-sm text-muted-foreground">
        {{ t('auth.loginTermsPrefix') }}<a href="#" class="underline underline-offset-4 hover:text-primary" @click.prevent>{{ t('auth.termsOfService') }}</a>{{ t('auth.and') }}<a href="#" class="underline underline-offset-4 hover:text-primary" @click.prevent>{{ t('auth.privacyPolicy') }}</a>
      </div>
    </main>
  </div>
</template>
