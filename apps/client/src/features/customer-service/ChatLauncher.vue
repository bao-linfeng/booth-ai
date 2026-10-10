<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Headset } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import { appLocale } from '@/plugins/i18n'
import ChatPanel from './ChatPanel.vue'
import { useCustomerService } from './useCustomerService'

// 全局悬浮按钮：右下角（阿拉伯语在左下角），显示未读角标；?cs=open 时自动打开（回复邮件中的链接）
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { state, openWith, startIdlePolling, stopIdlePolling } = useCustomerService()
const unread = computed(() => (state.open ? 0 : state.unreadCount))

watch(() => route.query.cs, value => {
  if (value !== 'open') return
  const { cs: _cs, ...query } = route.query
  void router.replace({ query })
  void openWith(undefined, 'floating')
}, { immediate: true })

onMounted(startIdlePolling)
onBeforeUnmount(stopIdlePolling)
</script>

<template>
  <button
    type="button"
    :class="cn(
      'fixed bottom-24 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:bottom-6',
      appLocale === 'ar' ? 'left-6' : 'right-6',
    )"
    :aria-label="unread ? `${t('customerService.launcher')} · ${t('customerService.unread', { count: unread })}` : t('customerService.launcher')"
    data-cs-launcher
    @click="openWith(undefined, 'floating')"
  >
    <Headset class="size-6" aria-hidden="true" />
    <span v-if="unread" class="absolute -top-1 -end-1 min-w-5 rounded-full bg-destructive px-1.5 text-xs leading-5 text-destructive-foreground" data-cs-unread>
      {{ unread > 99 ? '99+' : unread }}
    </span>
  </button>
  <ChatPanel />
</template>
