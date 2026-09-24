<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { inject, computed } from 'vue'
import type { CollectyVariants } from '.'
import type { SectionData } from '@/types/collecty'

const props = withDefaults(defineProps<{
  variant?: CollectyVariants['variant']
  size?: CollectyVariants['size']
  class?: HTMLAttributes['class']
}>(), {
  variant: 'default',
  size: 'md'
})

// Используем данные секции вместо локального состояния
const sectionData = inject<SectionData>('section-data')
const isActive = computed(() => sectionData?.isInCollection.value || false)
</script>

<template>
  <div :class="cn('relative inline-flex', props.class)">
    <slot />
  </div>
</template> 