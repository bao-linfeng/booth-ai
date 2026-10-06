<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MainNavigation from '@/components/navbar/MainNavigation.vue'

const { t } = useI18n()
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
      <a href="#main-content" class="sr-only z-[100] rounded-md bg-card text-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:px-4 focus:py-3">{{ t('controls.skipToContent') }}</a>
    <MainNavigation />
    <slot />
    <footer class="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 pb-8 pt-4 text-xs text-muted-foreground md:px-8 lg:px-10">
      <span>{{ t('controls.footerCompany') }}</span>
      <a
        class="tracking-wider underline-offset-2 hover:underline"
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
      >{{ t('controls.footerTagline') }}</a>
    </footer>
  </div>
</template>
