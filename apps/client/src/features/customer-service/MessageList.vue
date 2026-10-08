<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { appLocale, toIntlLocale } from '@/plugins/i18n'
import type { MessageDto } from '@/services/api/customer-service'
import MessageBubble from './MessageBubble.vue'
import { splitRounds } from './timeline'
import type { PendingMessage } from './useCustomerService'

const props = defineProps<{ messages: MessageDto[]; pending: PendingMessage[]; hasMore: boolean; empty: string }>()
const emit = defineEmits<{ 'load-older': []; retry: [clientMessageId: string] }>()
const { t } = useI18n()
const scroller = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
const rounds = computed(() => splitRounds(props.messages))
let observer: IntersectionObserver | undefined

const date = (value: string) => new Intl.DateTimeFormat(toIntlLocale(appLocale.value), { dateStyle: 'medium' }).format(new Date(value))

async function scrollToBottom() {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
}

// 新消息到达时贴底；向上加载历史时保持当前位置
let lastNewest = 0
watch(() => [props.messages.at(-1)?.seq ?? 0, props.pending.length] as const, async ([newest]) => {
  if (newest >= lastNewest) await scrollToBottom()
  lastNewest = newest
}, { immediate: true })

async function loadOlder() {
  const height = scroller.value?.scrollHeight ?? 0
  emit('load-older')
  await nextTick()
  if (scroller.value) scroller.value.scrollTop += scroller.value.scrollHeight - height
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !sentinel.value) return
  observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && props.hasMore) void loadOlder() }, { root: scroller.value })
  observer.observe(sentinel.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="scroller" class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" aria-live="polite">
    <div ref="sentinel" />
    <div v-if="hasMore" class="text-center">
      <Button variant="ghost" size="sm" @click="loadOlder">{{ t('customerService.loadOlder') }}</Button>
    </div>
    <p v-if="!messages.length && !pending.length" class="py-10 text-center text-sm text-muted-foreground">{{ empty }}</p>
    <section v-for="round in rounds" :key="round.conversationId" class="space-y-3">
      <div class="flex items-center gap-3 text-xs text-muted-foreground" data-cs-round>
        <span class="h-px flex-1 bg-border" />
        {{ t('customerService.round', { no: round.conversationNo, date: date(round.startedAt) }) }}
        <span class="h-px flex-1 bg-border" />
      </div>
      <MessageBubble v-for="message in round.messages" :key="message.id" :message="message" />
    </section>
    <div v-for="item in pending" :key="item.clientMessageId" class="flex flex-col items-end gap-1" data-cs-pending>
      <div class="max-w-[85%] rounded-2xl rounded-ee-sm bg-primary/70 px-3 py-2 text-sm text-primary-foreground">
        <p class="whitespace-pre-wrap break-words">{{ item.body }}</p>
      </div>
      <span v-if="item.status === 'sending'" class="flex items-center gap-1 px-1 text-xs text-muted-foreground">
        <Loader2 class="size-3 animate-spin" aria-hidden="true" />{{ t('customerService.sending') }}
      </span>
      <span v-else class="flex items-center gap-2 px-1 text-xs text-destructive">
        {{ t('customerService.sendFailed') }}
        <button type="button" class="underline underline-offset-2" @click="emit('retry', item.clientMessageId)">{{ t('customerService.retry') }}</button>
      </span>
    </div>
  </div>
</template>
