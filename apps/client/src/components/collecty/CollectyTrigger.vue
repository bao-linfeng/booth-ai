<script setup lang="ts">
import { Bookmark } from 'lucide-vue-next'
import { inject, computed } from 'vue'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { collectyVariants, type CollectyVariants } from '.'
import type { SectionData } from '@/types/collecty'

const props = withDefaults(defineProps<{
  variant?: CollectyVariants['variant']
  size?: CollectyVariants['size']
  class?: HTMLAttributes['class']
}>(), {
  variant: 'default',
  size: 'md'
})

const sectionData = inject<SectionData>('section-data')

// Проверяем состояние в коллекции
const isActive = computed(() => sectionData?.isInCollection.value || false)

const handleClick = () => {
  console.log('Current state:', isActive.value)
  sectionData?.toggleCollection()
}
</script>

<template>
  <button
    type="button"
    :class="cn(
      collectyVariants({ 
        variant, 
        size, 
        state: isActive ? 'active' : 'inactive' 
      }), 
      props.class
    )"
    @click="handleClick"
  >
    <Bookmark
      :class="cn(
        'transition-transform duration-200',
        { 'fill-current text-primary': isActive }
      )"
      :aria-label="isActive ? 'Remove from collection' : 'Add to collection'"
    />
  </button>
</template> 