<script setup lang="ts">
import MainNavigation from '@/components/sections/navbar/MainNavigation.vue'
import { Button } from '@/components/ui/button'
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <MainNavigation />
    <nav class="container mx-auto flex justify-end px-4 pt-3" aria-label="项目导航"><Button variant="ghost" size="sm" as-child><RouterLink to="/my-projects">我的项目</RouterLink></Button></nav>
    <slot />
  </div>
</template>
