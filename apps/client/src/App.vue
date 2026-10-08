<script setup lang="ts">
import { watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, RouterView } from 'vue-router'
import ChatLauncher from '@/features/customer-service/ChatLauncher.vue'

const route = useRoute()
const { t } = useI18n()

watchEffect(() => {
  const titleKey = route.meta.titleKey
  document.title = typeof titleKey === 'string' ? `${t(titleKey)} · LingTong AI` : t('nav.brand')
})
</script>

<template>
  <RouterView />
  <!-- 在线客服悬浮按钮与面板全局常驻（含首页与回复邮件的 ?cs=open 落地页），登录页不显示 -->
  <ChatLauncher v-if="!route.path.startsWith('/auth')" />
</template>
