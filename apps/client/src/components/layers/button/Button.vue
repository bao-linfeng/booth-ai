<script setup lang="ts">
import { Button as BaseButton } from '@/components/ui/button'
import { buttonVariants } from './button'
import { cn } from '@/lib/utils'

interface Props {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon'
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  size: 'default'
})
</script>

<template>
  <BaseButton
    v-bind="$attrs"
    :variant="variant"
    :size="size"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot />
  </BaseButton>
</template>