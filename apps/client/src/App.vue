<script setup lang="ts">
import { watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, RouterView } from 'vue-router'

const route = useRoute()
const { t } = useI18n()

watchEffect(() => {
  const titleKey = route.meta.titleKey
  document.title = typeof titleKey === 'string' ? `${t(titleKey)} · LingTong AI` : t('nav.brand')
})
</script>

<template>
  <RouterView />
</template>
