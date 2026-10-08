<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// 留言模式：客服都不在线且会话排队中时替换输入框；访客必须留邮箱，登录用户预填账户邮箱
const props = defineProps<{ defaultEmail: string; requireEmail: boolean; sent: boolean }>()
const emit = defineEmits<{ submit: [body: string, email: string] }>()
const { t } = useI18n()
const email = ref(props.defaultEmail)
const body = ref('')
const emailError = ref(false)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function submit() {
  const text = body.value.trim()
  const address = email.value.trim()
  emailError.value = (props.requireEmail || Boolean(address)) && !EMAIL.test(address)
  if (!text || emailError.value) return
  emit('submit', text, address)
  body.value = ''
}
</script>

<template>
  <form class="space-y-3 border-t px-4 py-3" data-cs-offline @submit.prevent="submit">
    <p class="rounded-md bg-muted px-3 py-2 text-sm">{{ t('customerService.offlineHint') }}</p>
    <p v-if="sent" class="text-sm text-success">{{ t('customerService.offlineSent') }}</p>
    <div class="space-y-1">
      <Label for="cs-offline-email">{{ t('customerService.emailLabel') }}</Label>
      <Input id="cs-offline-email" v-model="email" type="email" autocomplete="email" :placeholder="t('customerService.emailPlaceholder')" :aria-invalid="emailError || undefined" />
      <p v-if="emailError" class="text-xs text-destructive">{{ t('customerService.emailInvalid') }}</p>
    </div>
    <Textarea v-model="body" :maxlength="2000" rows="3" :aria-label="t('customerService.leaveMessage')" :placeholder="t('customerService.messagePlaceholder')" />
    <Button type="submit" size="sm" class="w-full" :disabled="!body.trim()">{{ t('customerService.leaveMessage') }}</Button>
  </form>
</template>
