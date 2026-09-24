<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  as?: string
}>()
</script>

<template>
  <component
    :is="props.as || 'p'"
    :class="cn(
      'text-lg text-muted-foreground dark:text-muted-foreground/90 sm:text-xl max-w-[42rem]',
      props.class
    )"
  >
    <slot />
  </component>
</template> 