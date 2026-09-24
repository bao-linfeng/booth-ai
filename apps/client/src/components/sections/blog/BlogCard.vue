<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface Props {
  class?: HTMLAttributes['class']
  title: string
  description: string
  category?: string
  date?: string
  image?: string
  href?: string
  layout?: 'default' | 'horizontal'
}

const props = withDefaults(defineProps<Props>(), {
  layout: 'default'
})

const placeholderLight = 'https://images.unsplash.com/photo-1542125387-c71274d94f0a?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=560&q=80'
const placeholderDark = 'https://images.unsplash.com/photo-1542125387-c71274d94f0a?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=560&q=80'
</script>

<template>
  <div :class="cn(
    'group relative overflow-hidden rounded-lg border-glow shadow hover:shadow-xl transition-all',
    props.layout === 'horizontal' ? 'sm:flex' : '',
    props.class
  )">
    <div :class="cn(
      'overflow-hidden h-full',
      props.layout === 'horizontal' ? 'sm:w-56 h-44 flex-shrink-0' : 'aspect-video w-full'
    )">
      <img 
        :src="props.image || placeholderLight" 
        class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 dark:hidden"
        :alt="props.title"
      />
      <img 
        :src="props.image || placeholderDark"
        class="hidden h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 dark:block"
        :alt="props.title"
      />
    </div>

    <div :class="cn(
      'flex flex-col',
      props.layout === 'horizontal' 
        ? 'p-6' 
        : 'absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10 p-6'
    )">
      <div class="mb-2 flex items-center gap-2 mt-auto">
        <Badge v-if="props.category" variant="secondary" class="text-black dark:text-white">{{ props.category }}</Badge>
        <span v-if="props.date" class="text-sm text-white/80">{{ props.date }}</span>
      </div>
      
      <h3 class="text-xl font-semibold text-white group-hover:text-primary">{{ props.title }}</h3>
      <p class="mt-2 text-white/90">{{ props.description }}</p>
      
      <a 
        v-if="props.href"
        :href="props.href"
        class="mt-4 inline-flex items-center text-sm font-medium text-primary hover:text-white hover:underline"
      >
        Read more
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="ml-1 h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z"
            clip-rule="evenodd"
          />
        </svg>
      </a>
    </div>
  </div>
</template> 