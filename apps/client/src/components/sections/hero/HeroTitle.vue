<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { inject, computed } from 'vue'

interface TitleContext {
  defaultTag?: string
  defaultSize?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl'
}

const titleContext = inject<TitleContext>('heroTitle', {})

interface Props {
  class?: HTMLAttributes['class']
  as?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl'
}

const props = defineProps<Props>()

const tag = computed(() => props.as || titleContext.defaultTag || 'h2')
const size = computed(() => props.size || titleContext.defaultSize || '4xl')

const sizeClasses = {
  sm: 'text-lg sm:text-xl',
  md: 'text-xl sm:text-2xl',
  lg: 'text-2xl sm:text-3xl',
  xl: 'text-3xl sm:text-4xl',
  '2xl': 'text-3xl sm:text-5xl',
  '3xl': 'text-3xl sm:text-4xl md:text-6xl',
  '4xl': 'text-3xl sm:text-4xl md:text-7xl',
  '5xl': 'text-3xl sm:text-5xl md:text-8xl',
  '6xl': 'text-7xl sm:text-8xl md:text-9xl',
  '7xl': 'text-3xl sm:text-5xl md:text-6xl lg:text-7xl'
}
</script>

<template>
  <component
    :is="tag"
    :class="cn(
      'font-bold tracking-tight text-foreground',
      sizeClasses[size],
      props.class
    )"
  >
    <slot />
  </component>
</template> 