<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Expand, ImageOff } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import BoothIllustration from './BoothIllustration.vue'
import type { SchemeImage } from './types'
const props = withDefaults(defineProps<{ images: SchemeImage[]; code: string; preview?: boolean; variant?: number }>(), { preview: false, variant: 0 })
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
    <Button variant="ghost" class="relative block aspect-video h-auto w-full overflow-hidden rounded-md bg-image-surface p-0 hover:bg-image-surface" :disabled="!images.length" :aria-label="images.length ? `放大 ${code} 第 ${active + 1} 张图片` : `${code} 暂无效果图`" @click="openPreview">
      <div v-if="preview" class="h-full w-full [&>svg.booth-illustration]:h-full [&>svg.booth-illustration]:w-full"><BoothIllustration :variant="variant" :view="active" class="h-full w-full" /></div>
      <span v-else-if="!currentImage || failed" class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><ImageOff aria-hidden="true" />{{ images.length ? '图片暂不可用' : '暂无效果图' }}</span>
      <img v-else :key="currentImage.thumbnailUrl" :src="currentImage.thumbnailUrl" :alt="`${code} 第 ${active + 1} 张效果图`" class="h-full w-full object-contain" loading="lazy" @error="failed = true" />
      <span v-if="images.length" class="absolute bottom-3 left-3 rounded bg-background/90 px-2 py-1 font-mono text-xs">{{ active + 1 }} / {{ images.length }}</span>
      <span v-if="images.length" class="absolute bottom-3 right-3 flex items-center gap-1.5 rounded bg-background/90 px-2 py-1 text-xs"><Expand class="size-3.5" aria-hidden="true" />放大查看</span>
    </Button>
    <div v-if="images.length" class="grid max-w-md grid-cols-3 gap-3" role="group" :aria-label="`${code} 切换方案图片`">
      <Button v-for="(image, index) in images" :key="image.assetId" variant="ghost" :class="cn('h-auto min-w-0 flex-col gap-0 overflow-hidden rounded-sm border-b-2 bg-image-surface p-0', active === index ? 'border-primary' : 'border-transparent')" :aria-label="`查看第 ${index + 1} 张`" :aria-pressed="active === index" @click="active = index">
        <div v-if="preview" class="aspect-video w-full [&>svg.booth-illustration]:h-full [&>svg.booth-illustration]:w-full"><BoothIllustration :variant="variant" :view="index" class="h-full w-full" /></div>
        <img v-else :src="image.thumbnailUrl" alt="" loading="lazy" class="aspect-video w-full object-contain" />
        <span class="w-full bg-background py-2 text-xs">视角 {{ index + 1 }}<span v-if="active === index" class="block font-medium">当前视角</span></span>
      </Button>
    </div>
    <Dialog v-model:open="expanded">
      <DialogContent class="max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-lg p-4 sm:p-6" @close-auto-focus="restorePreviewFocus">
        <DialogTitle class="break-all pr-6 text-base">{{ code }} · {{ images.length ? active + 1 : 0 }} / {{ images.length }}</DialogTitle>
        <DialogDescription>{{ preview ? '空间示意，非真实方案效果图。' : '方案效果图，仅作视觉及空间参考。' }}</DialogDescription>
        <BoothIllustration v-if="preview" :variant="variant" :view="active" class="w-full" />
        <div v-else-if="!currentImage || originalFailed" class="flex min-h-48 flex-col items-center justify-center gap-2 bg-muted text-muted-foreground"><ImageOff aria-hidden="true" />{{ images.length ? '原图暂不可用，请切换其他视角。' : '暂无效果图' }}</div>
        <img v-else :key="currentImage.url" :src="currentImage.url" :alt="`${code} 第 ${active + 1} 张原始效果图`" class="max-h-[65dvh] w-full object-contain" @error="originalFailed = true" />
        <div class="flex flex-wrap justify-center gap-2" role="group" aria-label="切换放大视角">
          <Button v-for="(_, index) in images" :key="index" :variant="active === index ? 'default' : 'outline'" :aria-pressed="active === index" @click="active = index">视角 {{ index + 1 }}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
