<script setup lang="ts">
import { cn } from '@/lib/utils'
import { navbarLayerVariants } from './variants'
import type { HTMLAttributes } from 'vue'

type NavbarLayerProps = {
  class?: HTMLAttributes['class']
  position?: 'start' | 'center' | 'end'
}

const props = withDefaults(defineProps<NavbarLayerProps>(), {
  position: 'start'
})
</script>

<template>
  <div :class="cn(navbarLayerVariants({ position: props.position }), props.class)">
    <slot />
  </div>
</template> 