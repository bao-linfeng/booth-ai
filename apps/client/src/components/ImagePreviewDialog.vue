<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'

const props = withDefaults(defineProps<{
  open: boolean
  src?: string
  alt?: string
  title?: string
  description?: string
  imageClass?: string
  contentClass?: string
  imageError?: boolean
  errorMessage?: string
}>(), {
  src: undefined,
  alt: '',
  title: undefined,
  description: undefined,
  imageClass: 'max-h-[75dvh] w-full object-contain',
  contentClass: 'max-h-[90dvh] max-w-5xl overflow-y-auto',
  imageError: false,
  errorMessage: '图片加载失败，请关闭后重试。',
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  'close-auto-focus': [event: Event]
  'image-error': [event: Event]
}>()
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent :class="props.contentClass" @close-auto-focus="emit('close-auto-focus', $event)">
      <DialogTitle v-if="props.title">{{ props.title }}</DialogTitle>
      <DialogDescription v-if="props.description">{{ props.description }}</DialogDescription>
      <slot v-if="$slots.content" name="content" />
      <template v-else-if="props.src">
        <p v-if="props.imageError" role="alert" class="py-12 text-center text-sm text-muted-foreground">{{ props.errorMessage }}</p>
        <img v-else :src="props.src" :alt="props.alt" :class="props.imageClass" @error="emit('image-error', $event)" />
      </template>
    </DialogContent>
  </Dialog>
</template>
