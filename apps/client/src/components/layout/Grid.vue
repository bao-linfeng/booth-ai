<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const gridVariants = cva(
  'grid',
  {
    variants: {
      cols: {
        1: 'grid-cols-1',
        2: 'grid-cols-1 sm:grid-cols-2',
        3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
        6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
      },
      gap: {
        none: 'gap-0',
        sm: 'gap-4',
        md: 'gap-6',
        lg: 'gap-8',
        xl: 'gap-10'
      },
      align: {
        start: 'items-start',
        center: 'items-center',
        end: 'items-end',
        stretch: 'items-stretch'
      }
    },
    defaultVariants: {
      cols: 3,
      gap: 'md',
      align: 'stretch'
    }
  }
)

type GridVariants = VariantProps<typeof gridVariants>

interface Props extends /* @vue-ignore */ GridVariants {
  class?: HTMLAttributes['class']
  as?: string
}

const props = withDefaults(defineProps<Props>(), {
  as: 'div'
})

defineExpose({
  gridVariants
})
</script>

<template>
  <component
    :is="props.as"
    :class="cn(gridVariants({ cols: props.cols, gap: props.gap, align: props.align }), props.class)"
  >
    <slot />
  </component>
</template> 