<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { cva } from 'class-variance-authority'

interface Props {
  class?: HTMLAttributes['class']
  aspectRatio?: 'square' | 'video' | 'portrait' | 'auto'
}

const props = withDefaults(defineProps<Props>(), {
  aspectRatio: 'auto'
})

const mediaVariants = cva(
  'relative overflow-hidden',
  {
    variants: {
      rounded: {
        none: 'rounded-none',
        sm: 'rounded-lg',
        md: 'rounded-2xl',
        lg: 'rounded-[2rem]'
      },
      shadow: {
        none: '',
        sm: 'shadow-md',
        md: 'shadow-xl',
        lg: 'shadow-2xl'
      },
      aspectRatio: {
        square: 'aspect-square',
        video: 'aspect-video',
        portrait: 'aspect-[3/4]',
        auto: ''
      },
      overlay: {
        none: '',
        light: 'bg-background/50',
        dark: 'bg-background/80',
        gradient: 'bg-gradient-to-tr from-primary/20 to-primary/5'
      }
    },
    defaultVariants: {
      rounded: 'sm',
      shadow: 'none',
      aspectRatio: 'auto',
      overlay: 'none'
    }
  }
)
</script>

<template>
  <div :class="cn(mediaVariants, props.class)">
    <slot />
  </div>
</template> 