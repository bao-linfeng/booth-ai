<script setup lang="ts">
import { inject, computed } from 'vue'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import type { SectionData } from '@/types/collecty'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()

const sectionData = inject<SectionData>('section-data')
const isActive = computed(() => sectionData?.isInCollection.value || false)
</script>

<template>
  <div
    v-if="isActive"
    :class="cn(
      'absolute -right-1',
      'h-2 w-2 rounded-full',
      'bg-primary',
      'transition-all duration-200',
      props.class
    )"
  />
</template> 