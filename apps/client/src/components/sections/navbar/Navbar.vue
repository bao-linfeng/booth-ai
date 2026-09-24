<script setup lang="ts">
import { cn } from '@/lib/utils'
import { navbarVariants } from './variants'
import type { HTMLAttributes } from 'vue'

type NavbarProps = {
  class?: HTMLAttributes['class']
  position?: 'fixed' | 'sticky' | 'relative'
  size?: 'sm' | 'default' | 'lg'
}

const props = withDefaults(defineProps<NavbarProps>(), {
  position: 'sticky',
  size: 'default'
})
</script>

<template>
  <header :class="cn(navbarVariants({ position: props.position, size: props.size }), props.class)">
    <div class="container flex h-full items-center gap-4 px-4">
      <slot />
    </div>
  </header>
</template> 