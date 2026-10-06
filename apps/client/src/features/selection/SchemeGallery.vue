<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Expand, ImageOff } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import BoothIllustration from './BoothIllustration.vue'
import type { SchemeImage } from './types'
import { useI18n } from 'vue-i18n'
const props = withDefaults(defineProps<{ images: SchemeImage[]; code: string; preview?: boolean; variant?: number }>(), { preview: false, variant: 0 })
const { t } = useI18n()
const active = defineModel<number>('active', { default: 0 })
const expanded = ref(false)
const failed = ref(false)
const originalFailed = ref(false)
let previewTrigger: HTMLElement | null = null
const currentImage = computed(() => props.images[active.value])
function openPreview(event: MouseEvent) {
  previewTrigger = event.currentTarget as HTMLElement
  expanded.value = true
}
function restorePreviewFocus(event: Event) {
  if (!previewTrigger?.isConnected) return
  event.preventDefault()
  previewTrigger.focus()
}
function normalizeActive(value: number) {
  return Number.isInteger(value) && value >= 0 && value < props.images.length ? value : 0
}
watch(() => [props.code, props.images, active.value], () => {
  active.value = normalizeActive(active.value)
}, { immediate: true })
watch(() => [props.code, currentImage.value?.thumbnailUrl, currentImage.value?.url], () => {
  failed.value = false
  originalFailed.value = false
})
</script>

<template>
  <div class="min-w-0 space-y-3">
    <Button variant="ghost" class="relative block aspect-video h-auto w-full overflow-hidden rounded-md bg-image-surface p-0 hover:bg-image-surface" :disabled="!images.length" :aria-label="images.length ? t('gallery.enlargeImage', { code, index: active + 1 }) : t('gallery.noImages', { code })" @click="openPreview">
      <div v-if="preview" class="h-full w-full [&>svg.booth-illustration]:h-full [&>svg.booth-illustration]:w-full"><BoothIllustration :variant="variant" :view="active" class="h-full w-full" /></div>
      <span v-else-if="!currentImage || failed" class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><ImageOff aria-hidden="true" />{{ images.length ? t('gallery.imageUnavailable') : t('gallery.noEffectImage') }}</span>
      <img v-else :key="currentImage.thumbnailUrl" :src="currentImage.thumbnailUrl" :alt="t('gallery.effectAlt', { code, index: active + 1 })" class="h-full w-full object-contain" loading="lazy" @error="failed = true" />
      <span v-if="images.length" class="absolute bottom-3 left-3 rounded bg-background/90 px-2 py-1 font-mono text-xs">{{ active + 1 }} / {{ images.length }}</span>
      <span v-if="images.length" class="absolute bottom-3 right-3 flex items-center gap-1.5 rounded bg-background/90 px-2 py-1 text-xs"><Expand class="size-3.5" aria-hidden="true" />{{ t('gallery.enlarge') }}</span>
    </Button>
    <div v-if="images.length" class="grid max-w-md grid-cols-3 gap-3" role="group" :aria-label="t('gallery.switchImages', { code })">
      <Button v-for="(image, index) in images" :key="image.assetId" variant="ghost" :class="cn('h-auto min-w-0 flex-col gap-0 overflow-hidden rounded-sm border-b-2 bg-image-surface p-0', active === index ? 'border-primary' : 'border-transparent')" :aria-label="t('gallery.viewImage', { index: index + 1 })" :aria-pressed="active === index" @click="active = index">
        <div v-if="preview" class="aspect-video w-full [&>svg.booth-illustration]:h-full [&>svg.booth-illustration]:w-full"><BoothIllustration :variant="variant" :view="index" class="h-full w-full" /></div>
        <img v-else :src="image.thumbnailUrl" alt="" loading="lazy" class="aspect-video w-full object-contain" />
        <span class="w-full bg-background py-2 text-xs">{{ t('gallery.angle', { index: index + 1 }) }}<span v-if="active === index" class="block font-medium">{{ t('gallery.currentAngle') }}</span></span>
      </Button>
    </div>
    <Dialog v-model:open="expanded">
      <DialogContent class="max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-lg p-4 sm:p-6" @close-auto-focus="restorePreviewFocus">
        <DialogTitle class="break-all pr-6 text-base">{{ code }} · {{ images.length ? active + 1 : 0 }} / {{ images.length }}</DialogTitle>
        <DialogDescription>{{ preview ? t('gallery.previewSpace') : t('gallery.schemeImageNote') }}</DialogDescription>
        <BoothIllustration v-if="preview" :variant="variant" :view="active" class="w-full" />
        <div v-else-if="!currentImage || originalFailed" class="flex min-h-48 flex-col items-center justify-center gap-2 bg-muted text-muted-foreground"><ImageOff aria-hidden="true" />{{ images.length ? t('gallery.originalUnavailable') : t('gallery.noEffectImage') }}</div>
        <img v-else :key="currentImage.url" :src="currentImage.url" :alt="t('gallery.originalEffectAlt', { code, index: active + 1 })" class="max-h-[65dvh] w-full object-contain" @error="originalFailed = true" />
        <div class="flex flex-wrap justify-center gap-2" role="group" :aria-label="t('gallery.switchEnlargedAngle')">
          <Button v-for="(_, index) in images" :key="index" :variant="active === index ? 'default' : 'outline'" :aria-pressed="active === index" @click="active = index">{{ t('gallery.angle', { index: index + 1 }) }}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
