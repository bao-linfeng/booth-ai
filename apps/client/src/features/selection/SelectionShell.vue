<script setup lang="ts">
import MainNavigation from '@/components/sections/navbar/MainNavigation.vue'
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <MainNavigation />
    <slot />
  </div>
</template>
