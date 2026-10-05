<script setup lang="ts">
import MainNavigation from '@/components/navbar/MainNavigation.vue'
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <a href="#main-content" class="sr-only z-[100] rounded-md bg-card text-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:px-4 focus:py-3">跳至主要内容</a>
    <MainNavigation />
    <slot />
    <footer class="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 pb-8 pt-4 text-xs text-muted-foreground md:px-8 lg:px-10">
      <span>灵通展览展示集团 · LINGTONG</span>
      <span class="tracking-wider">专注展陈空间 · Since 1986</span>
    </footer>
  </div>
</template>
