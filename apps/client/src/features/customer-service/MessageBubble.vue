<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { MessageDto } from '@/services/api/customer-service'
import ContextCard from './ContextCard.vue'
import { displayBody } from './timeline'

// 消息气泡：正文只按纯文本插值渲染（禁止 v-html）；坐席消息默认显示译文，可切换原文
const props = defineProps<{ message: MessageDto }>()
const { t } = useI18n()
const showOriginal = ref(false)
const shown = computed(() => displayBody(props.message, showOriginal.value))
const own = computed(() => props.message.senderType === 'customer')
const agentName = computed(() => props.message.senderName || t('customerService.defaultAgent'))
const eventName = computed(() => {
  const name = props.message.eventParams?.agentName
  return typeof name === 'string' && name ? name : t('customerService.defaultAgent')
})

const bubble = cva('max-w-[85%] rounded-2xl px-3 py-2 text-sm', {
  variants: { own: { true: 'rounded-ee-sm bg-primary text-primary-foreground', false: 'rounded-es-sm bg-muted text-foreground' } },
})
</script>

<template>
  <p v-if="message.kind === 'event'" class="text-center text-xs text-muted-foreground" data-cs-event>
    {{ t(`customerService.events.${message.eventCode}`, { name: eventName }) }}
  </p>
  <ContextCard v-else-if="message.kind === 'context' && message.context" :context="message.context" />
  <div v-else :class="cn('flex flex-col gap-1', own ? 'items-end' : 'items-start')" data-cs-message>
    <span v-if="!own" class="px-1 text-xs text-muted-foreground">{{ agentName }}</span>
    <div :class="bubble({ own })">
      <p class="whitespace-pre-wrap break-words">{{ shown.body }}</p>
    </div>
    <div v-if="message.senderType === 'agent' && message.translation" class="flex gap-2 px-1 text-xs text-muted-foreground">
      <span v-if="shown.status === 'pending'">{{ t('customerService.translating') }}</span>
      <span v-else-if="shown.status === 'failed'">{{ t('customerService.translationFailed') }}</span>
      <button v-if="message.translation.status === 'done'" type="button" class="underline-offset-2 hover:underline" @click="showOriginal = !showOriginal">
        {{ showOriginal ? t('customerService.viewTranslation') : t('customerService.viewOriginal') }}
      </button>
    </div>
  </div>
</template>
