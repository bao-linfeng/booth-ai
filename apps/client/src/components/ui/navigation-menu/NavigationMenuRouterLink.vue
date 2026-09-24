<script setup lang="ts">
import { cn } from '@/lib/utils'
import { RouterLink } from 'vue-router'
import type { HTMLAttributes } from 'vue'

defineProps<{
  to: string
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <RouterLink
    :to="to"
    :class="cn(
      'block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
      $props.class
    )"
  >
    <slot />
  </RouterLink>
</template> 