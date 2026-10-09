<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SendHorizontal } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const MAX = 2000
const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ send: [body: string] }>()
const { t } = useI18n()
// 草稿由面板持有，与留言表单共用
const body = defineModel<string>({ default: '' })

function submit() {
  const text = body.value.trim()
  if (!text || props.disabled) return
  emit('send', text)
  body.value = ''
}

// Enter 发送，Shift+Enter 换行；输入法组字时不发送
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    submit()
  }
}
</script>

<template>
  <form class="space-y-2 border-t px-4 py-3" @submit.prevent="submit">
    <slot name="tools" />
    <Textarea
      v-model="body"
      :maxlength="MAX"
      rows="2"
      class="max-h-40 min-h-[44px] resize-none [field-sizing:content]"
      :placeholder="t('customerService.messagePlaceholder')"
      :aria-label="t('customerService.messagePlaceholder')"
      @keydown="onKeydown"
    />
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>{{ body.length }}/{{ MAX }}</span>
      <Button type="submit" size="sm" :disabled="disabled || !body.trim()">
        <SendHorizontal class="me-1 size-4 rtl:-scale-x-100" aria-hidden="true" />{{ t('customerService.send') }}
      </Button>
    </div>
  </form>
</template>
