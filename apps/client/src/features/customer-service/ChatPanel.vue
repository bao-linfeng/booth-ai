<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from 'lucide-vue-next'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { appLocale } from '@/plugins/i18n'
import { useAuthStore } from '@/stores/auth'
import Composer from './Composer.vue'
import MessageList from './MessageList.vue'
import OfflineForm from './OfflineForm.vue'
import SendContextButton from './SendContextButton.vue'
import { useCustomerService } from './useCustomerService'

// 聊天面板：桌面端宽 400px，移动端全屏；阿拉伯语使用 RTL
const { t } = useI18n()
const auth = useAuthStore()
const { state, closePanel, send, sendOffline, retry, loadOlder } = useCustomerService()
const offlineSent = ref(false)
/** 输入框与留言表单共用的草稿：坐席在线状态推送可能随时切换两者 */
const draft = ref('')
const rtl = computed(() => appLocale.value === 'ar')

const open = computed({
  get: () => state.open,
  set: value => { if (!value) closePanel() },
})

// 留言模式：没有坐席在线且会话仍在排队（已接入或已结束时照常对话）
const offlineMode = computed(() => !state.agentsOnline && (!state.conversation || state.conversation.status === 'queued'))

const status = computed(() => {
  if (state.connection === 'polling') return t('customerService.statusReconnecting')
  const conversation = state.conversation
  if (!conversation) return ''
  if (conversation.status === 'closed') return t('customerService.statusClosed')
  if (conversation.status === 'active') return t('customerService.statusActive', { name: conversation.agent?.displayName || t('customerService.defaultAgent') })
  return offlineMode.value ? '' : t('customerService.statusQueued')
})

async function submitOffline(body: string, email: string) {
  offlineSent.value = await sendOffline(body, email)
}
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent
      :side="rtl ? 'left' : 'right'"
      :dir="rtl ? 'rtl' : 'ltr'"
      class="flex h-full w-full flex-col gap-0 p-0 sm:w-[400px] sm:max-w-[400px]"
      data-cs-panel
    >
      <SheetHeader class="border-b px-4 py-3 text-start">
        <SheetTitle>{{ t('customerService.title') }}</SheetTitle>
        <SheetDescription class="text-sm" data-cs-status>{{ status }}</SheetDescription>
      </SheetHeader>
      <p v-if="state.notice" class="border-b bg-muted px-4 py-2 text-sm" role="status">
        {{ t(`customerService.${state.notice}`) }}
      </p>
      <div v-if="state.busy && !state.loaded" class="flex flex-1 items-center justify-center">
        <Loader2 class="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
      <MessageList
        v-else
        :messages="state.messages"
        :pending="state.pending"
        :has-more="state.hasMore"
        :empty="t('customerService.empty')"
        @load-older="loadOlder"
        @retry="retry"
      />
      <OfflineForm
        v-if="offlineMode"
        v-model="draft"
        :default-email="state.conversation?.contactEmail ?? auth.currentUser?.email ?? ''"
        :require-email="!auth.isLoggedIn"
        :sent="offlineSent"
        @submit="submitOffline"
      >
        <template #tools><SendContextButton /></template>
      </OfflineForm>
      <Composer v-else v-model="draft" :disabled="state.busy" @send="send">
        <template #tools><SendContextButton /></template>
      </Composer>
    </SheetContent>
  </Sheet>
</template>
