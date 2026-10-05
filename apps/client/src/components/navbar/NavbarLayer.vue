<script setup lang="ts">
import { cn } from '@/lib/utils'
import { navbarLayerVariants } from './variants'
import type { HTMLAttributes } from 'vue'

const props = withDefaults(defineProps<{ class?: HTMLAttributes['class']; position?: 'start' | 'center' | 'end' }>(), { position: 'start' })
</script>

<template>
  <div :class="cn(navbarLayerVariants({ position: props.position }), props.class)"><slot /></div>
</template>
