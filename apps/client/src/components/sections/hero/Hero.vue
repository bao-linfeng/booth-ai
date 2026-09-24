<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, provide, ref, onMounted } from 'vue'
import { cn } from '@/lib/utils'
import Section from '@/components/layout/Section.vue'
import { heroVariants } from './variants'
import { Collecty, CollectyTrigger, CollectyIndicator } from '@/components/collecty'
import { useCollecty } from '@/composables/useCollecty'
import type { SectionData } from '@/types/collecty'

interface Props {
  align?: 'left' | 'center' | 'right'
  layout?: 'default' | 'split' | 'splitBox' | 'centered' | 'asymmetric'
  container?: 'none' | 'box' | 'full'
  height?: 'auto' | 'screen' | 'large' | 'medium' | 'nav'
  spacing?: 'none' | 'sm' | 'md' | 'lg'
  class?: HTMLAttributes['class']
  sectionKey: string
}

const props = withDefaults(defineProps<Props>(), {
  align: 'center',
  layout: 'default',
  container: 'full',
  height: 'medium',
  spacing: 'none'
})

const { isInCollection, addToCollection, removeFromCollection } = useCollecty()

// Защита от двойного срабатывания
const isProcessing = ref(false)

const sectionId = computed(() => {
  const path = window.location.pathname.replace(/\//g, '_')
  const id = `hero__${props.sectionKey}`
  console.log('Generated section ID:', id, 'Path:', path)
  return id
})

const inCollection = computed(() => {
  const result = isInCollection(sectionId.value)
  console.log('Section in collection check:', sectionId.value, result)
  return result
})

// Проверяем состояние при монтировании и при изменении маршрута
onMounted(() => {
  console.log('Hero mounted, checking collection state for:', sectionId.value)
  inCollection.value
})

provide<SectionData>('section-data', {
  id: sectionId,
  isInCollection: inCollection,
  toggleCollection: () => {
    if (isProcessing.value) {
      console.log('Operation in progress, skipping...')
      return
    }

    isProcessing.value = true
    console.log('Toggle collection for:', sectionId.value)

    try {
      if (inCollection.value) {
        removeFromCollection(sectionId.value)
      } else {
        addToCollection(sectionId.value, window.location.pathname)
      }
    } finally {
      // Сбрасываем флаг после небольшой задержки
      setTimeout(() => {
        isProcessing.value = false
      }, 300)
    }
  }
})
</script>

<template>
  <Section 
    :class="cn(
      heroVariants({ 
        align: props.align,
        height: props.height,
        spacing: props.spacing 
      }), 
      'flex flex-col relative',
      props.class
    )"
  >
    <Collecty class="absolute top-2 right-2 z-10">
      <CollectyTrigger />
    </Collecty>
    <div 
      :class="cn(
        heroVariants({ 
          container: props.container,
          layout: props.layout 
        }),
        'flex-1'
      )"
    >
      <slot />
    </div>
  </Section>
</template> 