<script setup lang="ts">
import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'vue'

const containerVariants = cva(
  'container mx-auto',
  {
    variants: {
      size: {
        sm: 'max-w-screen-sm',
        md: 'max-w-screen-md',
        lg: 'max-w-screen-lg',
        xl: 'max-w-screen-xl',
        '2xl': 'max-w-screen-2xl',
      },
      padding: {
        none: '',
        sm: 'px-4 md:px-6 lg:px-8',
        md: 'px-6 md:px-8 lg:px-12',
        lg: 'px-8 md:px-12 lg:px-16',
      }
    },
    defaultVariants: {
      size: 'xl',
      padding: 'md'
    }
  }
)

type ContainerVariants = VariantProps<typeof containerVariants>

interface Props extends /* @vue-ignore */ ContainerVariants {
  class?: HTMLAttributes['class']
  as?: string
}

const props = withDefaults(defineProps<Props>(), {
  as: 'div'
})

defineExpose({
  containerVariants
})
</script>

<template>
  <component
    :is="as"
    :class="cn(containerVariants({ size: props.size, padding: props.padding }), props.class)"
  >
    <slot />
  </component>
</template>