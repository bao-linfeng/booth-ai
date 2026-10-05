<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/composables/useAuth'

const username = ref('')
const password = ref('')
const { login, loading, error } = useAuth()

const handleLogin = async () => {
  if (!username.value || !password.value) return
  await login(username.value, password.value)
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen p-4 min-w-screen bg-background">
    <main class="flex flex-col gap-6 w-full max-w-sm">
      <div class="flex flex-col items-center gap-2 text-center">
        <h1 class="text-2xl font-bold tracking-tight">灵通 AI 展台</h1>
        <p class="text-sm text-muted-foreground">智能展台方案平台</p>
      </div>
      <Card class="w-full">
        <CardHeader>
          <CardTitle class="text-2xl">登录</CardTitle>
          <CardDescription>
            输入您的用户名和密码以登录账户
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-4">
          <div class="grid gap-2">
            <Label for="username">用户名</Label>
            <Input id="username" v-model="username" type="text" placeholder="请输入用户名" required />
          </div>
          <div class="grid gap-2">
            <Label for="password">密码</Label>
            <Input id="password" v-model="password" type="password" required placeholder="*********" @keyup.enter="handleLogin" />
          </div>
          <div class="flex items-center justify-between">
            <a href="https://lingtong.net.cn/forgetPassword" target="_blank" rel="noopener noreferrer" class="text-sm text-muted-foreground underline-offset-4 hover:underline">忘记密码？</a>
            <a href="https://lingtong.net.cn/register" target="_blank" rel="noopener noreferrer" class="text-sm text-muted-foreground underline-offset-4 hover:underline">注册</a>
          </div>
          <div v-if="error" class="text-sm text-destructive font-medium">{{ error }}</div>
          <Button class="w-full" @click="handleLogin" :disabled="loading">
            <span v-if="loading">登录中...</span>
            <span v-else>登录</span>
          </Button>
        </CardContent>
      </Card>
      <div class="text-center text-sm text-muted-foreground">
        登录即同意<a href="#" class="underline underline-offset-4 hover:text-primary" @click.prevent>服务条款</a>和<a href="#" class="underline underline-offset-4 hover:text-primary" @click.prevent>隐私政策</a>
      </div>
    </main>
  </div>
</template>
